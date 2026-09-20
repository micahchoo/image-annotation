import type { App, TAbstractFile, TFile } from 'obsidian';
import type {
  Connection, Geometry, MediaSource, PassageTarget, Point, Region, RegionData,
} from './types';

const ROOT = 'Image Annotation';
const INDEX = `${ROOT}/index.json`;
const CAPTIONS = `${ROOT}/Captions`;
const BODY_START = '<!-- image-annotation:body -->';
const BODY_END = '<!-- image-annotation:end -->';

export class RegionStore {
  private data: RegionData = { version: 1, regions: [], connections: [] };
  private regionsById = new Map<string, Region>();
  private connectionsById = new Map<string, Connection>();
  private pendingChanges = new Set<string>();
  private loaded = false;
  private diskIndex: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private sequence = 0;

  constructor(private readonly app: App) {}

  async load(): Promise<void> {
    await this.enqueue(async () => {
      const current = await this.readDisk();
      this.adopt(current.data);
      this.diskIndex = current.raw;
      this.loaded = true;
    });
  }

  allRegions(): Region[] {
    return this.data.regions.map(copy);
  }

  getRegion(id: string): Region | undefined {
    const region = this.regionsById.get(id);
    return region ? copy(region) : undefined;
  }

  getConnection(id: string): Connection | undefined {
    const connection = this.connectionsById.get(id);
    return connection ? copy(connection) : undefined;
  }

  getConnections(regionId: string): Connection[] {
    return this.data.connections.filter(item => item.regionId === regionId).map(copy);
  }

  async createRegion(source: MediaSource, geometry: Geometry, title: string): Promise<Region> {
    return this.mutate(async () => {
      const normalizedSource = validateSource(source);
      const normalizedGeometry = validateGeometry(geometry);
      const normalizedTitle = validateTitle(title);
      const region: Region = {
        id: this.newId('r'), title: normalizedTitle, source: normalizedSource,
        geometry: normalizedGeometry, created: new Date().toISOString(),
      };
      const next = { ...this.data, regions: [...this.data.regions, region] };
      await this.commit(next, this.diskIndex);
      return copy(region);
    });
  }

  async updateRegion(id: string, geometry: Geometry, title: string): Promise<Region> {
    return this.mutate(async () => {
      const existing = this.data.regions.find(region => region.id === id);
      if (!existing) throw new Error(`Cannot update unknown region: ${id}`);
      const updated: Region = {
        ...existing,
        title: validateTitle(title),
        geometry: validateGeometry(geometry),
      };
      const next = { ...this.data, regions: this.data.regions.map(region => region.id === id ? updated : region) };
      await this.commit(next, this.diskIndex);
      return copy(updated);
    });
  }

  async removeRegion(id: string): Promise<void> {
    return this.mutate(async () => {
      if (!this.data.regions.some(region => region.id === id)) throw new Error(`Cannot remove unknown region: ${id}`);
      const next = {
        ...this.data,
        regions: this.data.regions.filter(region => region.id !== id),
        connections: this.data.connections.filter(connection => connection.regionId !== id),
      };
      await this.commit(next, this.diskIndex);
    });
  }

  async connect(regionId: string, target: PassageTarget, caption: string): Promise<Connection> {
    return this.mutate(async () => {
      if (!this.data.regions.some(region => region.id === regionId)) {
        throw new Error(`Cannot connect unknown region: ${regionId}`);
      }
      const normalizedTarget = validateTarget(target);
      if (typeof caption !== 'string') throw new Error('Caption must be text');
      const connectionId = this.newId('c');
      const connection: Connection = {
        id: connectionId, regionId, notePath: normalizedTarget.notePath,
        ...(normalizedTarget.blockId ? { blockId: normalizedTarget.blockId } : {}),
        captionPath: `${CAPTIONS}/${connectionId}.md`, created: new Date().toISOString(),
      };
      const captionText = renderCaption(this.getRegion(regionId)!, connection, caption);
      let createdCaption = false;
      try {
        await this.ensureFolder(CAPTIONS);
        await this.app.vault.create(connection.captionPath, captionText);
        createdCaption = true;
        await this.commit({ ...this.data, connections: [...this.data.connections, connection] }, this.diskIndex);
      } catch (error) {
        if (createdCaption) {
          const file = this.app.vault.getAbstractFileByPath(connection.captionPath);
          if (file) await this.app.fileManager.trashFile(file).catch(() => undefined);
        }
        throw error;
      }
      return copy(connection);
    });
  }

  async readCaption(connection: Connection): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(connection.captionPath);
    if (!file || !isFile(file) || file.extension !== 'md') throw new Error(`Caption file is missing: ${connection.captionPath}`);
    const text = await this.app.vault.read(file);
    return extractCaption(text);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    return this.mutate(async () => {
      const oldName = validatePath(oldPath, 'old path');
      const newName = validatePath(newPath, 'new path');
      if (oldName === newName) return;
      let changed = false;
      const replace = (path: string) => path === oldName || path.startsWith(`${oldName}/`)
        ? (changed = true, `${newName}${path.slice(oldName.length)}`) : path;
      const regions = this.data.regions.map(region => ({
        ...region,
        source: {
          ...region.source,
          path: replace(region.source.path),
          ...(region.source.articlePath ? { articlePath: replace(region.source.articlePath) } : {}),
        },
      }));
      const connections = this.data.connections.map(connection => ({
        ...connection, notePath: replace(connection.notePath), captionPath: replace(connection.captionPath),
      }));
      if (!changed) return;
      await this.commit({ ...this.data, regions, connections }, this.diskIndex);
    });
  }

  private async mutate<T>(fn: () => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      if (!this.loaded) throw new Error('RegionStore.load() must be awaited before mutation');
      const current = await this.readDisk();
      this.adopt(current.data);
      this.diskIndex = current.raw;
      return fn();
    });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn, fn);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async commit(next: RegionData, expected: string | null): Promise<void> {
    const serialized = JSON.stringify(next, null, 2) + '\n';
    await this.ensureFolder(ROOT);
    const file = this.app.vault.getAbstractFileByPath(INDEX);
    if (file && isFile(file) && file.extension === 'json') {
      await this.app.vault.process(file, current => {
        if ((expected ?? '') !== current) throw new Error('Image Annotation index changed externally; reload and retry');
        return serialized;
      });
    } else if (file) {
      throw new Error('Image Annotation/index.json is not a regular file');
    } else {
      if (expected !== null) throw new Error('Image Annotation/index.json disappeared; reload and retry');
      await this.app.vault.create(INDEX, serialized);
    }
    this.adopt(next);
    this.diskIndex = serialized;
  }

  /** Consume invalidations once; unchanged reloads and own-write echoes are silent. */
  takeChanges(): Set<string> {
    const changes = this.pendingChanges;
    this.pendingChanges = new Set();
    return changes;
  }

  connectionsForPath(path: string): Set<string> {
    const matches = (value: string) => value === path || value.startsWith(`${path}/`);
    const regions = new Set(this.data.regions.filter(region => matches(region.source.path) || (region.source.articlePath && matches(region.source.articlePath))).map(region => region.id));
    return new Set(this.data.connections.filter(connection => regions.has(connection.regionId) || matches(connection.captionPath) || matches(connection.notePath)).map(connection => connection.id));
  }

  private adopt(next: RegionData): void {
    if (next === this.data) return;
    const regions = new Map(next.regions.map(region => [region.id, region]));
    const connections = new Map(next.connections.map(connection => [connection.id, connection]));
    const changedRegions = new Set<string>();
    for (const id of new Set([...this.regionsById.keys(), ...regions.keys()])) {
      if (JSON.stringify(this.regionsById.get(id)) !== JSON.stringify(regions.get(id))) changedRegions.add(id);
    }
    for (const id of new Set([...this.connectionsById.keys(), ...connections.keys()])) {
      const before = this.connectionsById.get(id), after = connections.get(id);
      if (JSON.stringify(before) !== JSON.stringify(after) || (before && changedRegions.has(before.regionId)) || (after && changedRegions.has(after.regionId))) this.pendingChanges.add(id);
    }
    this.data = next;
    this.regionsById = regions;
    this.connectionsById = connections;
  }

  private async readDisk(): Promise<{ data: RegionData; raw: string | null }> {
    const file = this.app.vault.getAbstractFileByPath(INDEX);
    if (!file) return { data: { version: 1, regions: [], connections: [] }, raw: null };
    if (!isFile(file) || file.extension !== 'json') throw new Error('Image Annotation/index.json is not a regular file');
    const raw = await this.app.vault.read(file);
    if (this.loaded && raw === this.diskIndex) return { data: this.data, raw };
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error('Image Annotation/index.json is corrupt JSON'); }
    return { data: validateData(value), raw };
  }

  private async ensureFolder(path: string): Promise<void> {
    const parts = path.split('/');
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }

  private newId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${Date.now().toString(36)}-${this.sequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function isFile(file: TAbstractFile): file is TFile {
  return 'extension' in file && 'stat' in file;
}

function validatePath(path: unknown, label = 'path'): string {
  if (typeof path !== 'string' || !path.trim() || path.startsWith('/') || path.includes('\\') || Array.from(path).some(char => char.charCodeAt(0) < 32)) {
    throw new Error(`Invalid ${label}`);
  }
  const parts = path.split('/');
  if (parts.some(part => !part || part === '..')) throw new Error(`Invalid ${label}`);
  return parts.filter(part => part !== '.').join('/');
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function validateSource(source: MediaSource): MediaSource {
  if (!source || typeof source !== 'object') throw new Error('Invalid source');
  const result: MediaSource = { ...source, path: validatePath(source.path, 'source path'), width: finite(source.width, 'source width'), height: finite(source.height, 'source height') };
  if (result.width <= 0 || result.height <= 0) throw new Error('Source dimensions must be positive');
  if (source.articlePath !== undefined) result.articlePath = validatePath(source.articlePath, 'article path');
  if (source.articleLine !== undefined && (!Number.isInteger(source.articleLine) || source.articleLine < 0)) throw new Error('Invalid article line');
  if (source.originalUrl !== undefined && (typeof source.originalUrl !== 'string' || !/^https?:\/\//i.test(source.originalUrl))) throw new Error('Invalid original URL');
  return result;
}

function validateGeometry(geometry: Geometry): Geometry {
  if (!geometry || typeof geometry !== 'object') throw new Error('Invalid geometry');
  if (geometry.type === 'rect') {
    const result = { type: 'rect' as const, x: finite(geometry.x, 'rectangle x'), y: finite(geometry.y, 'rectangle y'), width: finite(geometry.width, 'rectangle width'), height: finite(geometry.height, 'rectangle height') };
    if (result.width <= 0 || result.height <= 0 || result.x < 0 || result.y < 0 || result.x + result.width > 1 || result.y + result.height > 1) throw new Error('Rectangle must fit within normalized bounds');
    return result;
  }
  if (geometry.type !== 'polygon' || !Array.isArray(geometry.points) || geometry.points.length < 3) throw new Error('Polygon needs at least three points');
  const points = geometry.points.map((point: Point) => ({ x: finite(point.x, 'polygon x'), y: finite(point.y, 'polygon y') }));
  if (points.some(point => point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) throw new Error('Polygon points must be normalized');
  if (new Set(points.map(point => `${point.x},${point.y}`)).size < 3) throw new Error('Polygon needs three distinct vertices');
  let area = 0;
  for (let i = 0; i < points.length; i += 1) { const a = points[i]; const b = points[(i + 1) % points.length]; area += a.x * b.y - b.x * a.y; }
  if (Math.abs(area) < Number.EPSILON) throw new Error('Polygon area must be positive');
  return { type: 'polygon', points };
}

function validateTitle(title: string): string {
  if (typeof title !== 'string' || !title.trim()) throw new Error('Region title must not be empty');
  return title.trim();
}

function validateTarget(target: PassageTarget): PassageTarget {
  if (!target || typeof target !== 'object') throw new Error('Invalid passage target');
  const result: PassageTarget = { notePath: validatePath(target.notePath, 'note path') };
  if (target.blockId !== undefined) {
    if (typeof target.blockId !== 'string' || !/^[A-Za-z0-9-]+$/.test(target.blockId)) throw new Error('Invalid block id');
    result.blockId = target.blockId;
  }
  return result;
}

function renderCaption(region: Region, connection: Connection, body: string): string {
  const source = `![[${region.source.path}]]`;
  const writing = `[[${connection.notePath}${connection.blockId ? `#^${connection.blockId}` : ''}]]`;
  const article = region.source.articlePath ? `\nSource note: [[${region.source.articlePath}]]` : '';
  const original = region.source.originalUrl ? `\nOriginal URL: ${region.source.originalUrl}` : '';
  return `Source: ${source}${article}${original}\nNote: ${writing}\n\n${BODY_START}\n${body}\n${BODY_END}\n`;
}

function extractCaption(text: string): string {
  const start = text.indexOf(BODY_START);
  if (start < 0) return text;
  const bodyStart = start + BODY_START.length;
  const end = text.indexOf(BODY_END, bodyStart);
  const body = text.slice(bodyStart, end < 0 ? text.length : end);
  return body.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
}

function validateData(value: unknown): RegionData {
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) throw new Error('Unsupported or corrupt Image Annotation index version');
  const candidate = value as { regions?: unknown; connections?: unknown };
  if (!Array.isArray(candidate.regions) || !Array.isArray(candidate.connections)) throw new Error('Corrupt Image Annotation index');
  const regions = candidate.regions.map(item => {
    const region = item as Region;
    if (!region || typeof region.id !== 'string' || !region.id || typeof region.created !== 'string') throw new Error('Corrupt region record');
    return { id: region.id, title: validateTitle(region.title), source: validateSource(region.source), geometry: validateGeometry(region.geometry), created: region.created };
  });
  const ids = new Set(regions.map(region => region.id));
  const connections = candidate.connections.map(item => {
    const connection = item as Connection;
    if (!connection || typeof connection.id !== 'string' || !connection.id || !ids.has(connection.regionId) || typeof connection.created !== 'string') throw new Error('Corrupt connection record');
    const target = validateTarget(connection);
    return { id: connection.id, regionId: connection.regionId, notePath: target.notePath, ...(target.blockId ? { blockId: target.blockId } : {}), captionPath: validatePath(connection.captionPath, 'caption path'), created: connection.created };
  });
  if (new Set([...regions.map(item => item.id), ...connections.map(item => item.id)]).size !== regions.length + connections.length) throw new Error('Duplicate Image Annotation record id');
  return { version: 1, regions, connections };
}

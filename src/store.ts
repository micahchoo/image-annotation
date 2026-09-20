import type { App, TAbstractFile, TFile } from 'obsidian';
import type {
  Connection, Geometry, MediaSource, PassageTarget, Point, Region, RegionData,
} from './types';

const ROOT = 'Image Annotation';
const INDEX = `${ROOT}/index.json`;
const CAPTIONS = `${ROOT}/Captions`;
const BODY_START = '<!-- image-annotation:body -->';
const BODY_END = '<!-- image-annotation:end -->';
type Delta = { regions?: Region[]; connections?: Connection[]; removedRegions?: string[]; removedConnections?: string[] };


export class RegionStore {
  private data: RegionData = { version: 1, regions: [], connections: [] };
  private regionsById = new Map<string, Region>();
  private connectionsById = new Map<string, Connection>();
  private connectionsByRegion = new Map<string, Set<string>>();
  private connectionsByPath = new Map<string, Set<string>>();
  private imagePathsSnapshot?: readonly string[];
  private regionImages = new Map<string, Set<string>>();
  private serializedRecords = new WeakMap<object, string>();
  private pendingChanges = new Set<string>();
  private loaded = false;
  private diskIndex: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private sequence = 0;

  constructor(private readonly app: App) {}

  async load(): Promise<void> {
    await this.enqueue(async () => {
      const current = await this.readDisk();
      await this.adopt(current.data);
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
    return [...(this.connectionsByRegion.get(regionId) ?? [])].map(id => copy(this.connectionsById.get(id)!));
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
      await this.commit(next, this.diskIndex, { regions: [region] });
      return copy(region);
    });
  }

  async updateRegion(id: string, geometry: Geometry, title: string): Promise<Region> {
    return this.mutate(async () => {
      const existing = this.regionsById.get(id);
      if (!existing) throw new Error(`Cannot update unknown region: ${id}`);
      const updated: Region = {
        ...existing,
        title: validateTitle(title),
        geometry: validateGeometry(geometry),
      };
      const next = { ...this.data, regions: this.data.regions.map(region => region.id === id ? updated : region) };
      await this.commit(next, this.diskIndex, { regions: [updated] });
      return copy(updated);
    });
  }

  async removeRegion(id: string): Promise<void> {
    return this.mutate(async () => {
      if (!this.regionsById.has(id)) throw new Error(`Cannot remove unknown region: ${id}`);
      const next = {
        ...this.data,
        regions: this.data.regions.filter(region => region.id !== id),
        connections: this.data.connections.filter(connection => connection.regionId !== id),
      };
      await this.commit(next, this.diskIndex, { removedRegions: [id], removedConnections: [...(this.connectionsByRegion.get(id) ?? [])] });
    });
  }

  async connect(regionId: string, target: PassageTarget, caption: string): Promise<Connection> {
    return this.mutate(async () => {
      if (!this.regionsById.has(regionId)) {
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
        await this.commit({ ...this.data, connections: [...this.data.connections, connection] }, this.diskIndex, { connections: [connection] });
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
      const replace = (path: string) => path === oldName || path.startsWith(`${oldName}/`)
        ? `${newName}${path.slice(oldName.length)}` : path;
      const changedRegions: Region[] = [], changedConnections: Connection[] = [];
      const regions = await mapBatched(this.data.regions, region => {
        const path = replace(region.source.path), articlePath = region.source.articlePath ? replace(region.source.articlePath) : undefined;
        if (path === region.source.path && articlePath === region.source.articlePath) return region;
        const updated = { ...region, source: { ...region.source, path, ...(articlePath ? { articlePath } : {}) } };
        changedRegions.push(updated); return updated;
      });
      const connections = await mapBatched(this.data.connections, connection => {
        const notePath = replace(connection.notePath), captionPath = replace(connection.captionPath);
        if (notePath === connection.notePath && captionPath === connection.captionPath) return connection;
        const updated = { ...connection, notePath, captionPath };
        changedConnections.push(updated); return updated;
      });
      if (!changedRegions.length && !changedConnections.length) return;
      await this.commit({ ...this.data, regions, connections }, this.diskIndex, { regions: changedRegions, connections: changedConnections });
    });
  }

  private async mutate<T>(fn: () => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      if (!this.loaded) throw new Error('RegionStore.load() must be awaited before mutation');
      const current = await this.readDisk();
      await this.adopt(current.data);
      this.diskIndex = current.raw;
      return fn();
    });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn, fn);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async commit(next: RegionData, expected: string | null, delta: Delta): Promise<void> {
    const serialized = await this.serialize(next);
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
    let affectedCount = (delta.connections?.length ?? 0) + (delta.removedConnections?.length ?? 0);
    for (const region of delta.regions ?? []) {
      if (affectedCount > 256) break;
      affectedCount += (this.connectionsByRegion.get(region.id)?.size ?? 0) + 1;
    }
    for (const id of delta.removedRegions ?? []) {
      if (affectedCount > 256) break;
      affectedCount += (this.connectionsByRegion.get(id)?.size ?? 0) + 1;
    }
    if (affectedCount > 256) await this.adopt(next);
    else this.applyDelta(next, delta);
    this.diskIndex = serialized;
  }

  /** Consume invalidations once; unchanged reloads and own-write echoes are silent. */
  takeChanges(): Set<string> {
    const changes = this.pendingChanges;
    this.pendingChanges = new Set();
    return changes;
  }

  connectionsForPath(path: string): Set<string> {
    return new Set(this.connectionsByPath.get(path) ?? []);
  }

  /** Immutable source-path snapshot; cleanup can reuse it until regions change. */
  imagePaths(): readonly string[] {
    return this.imagePathsSnapshot ??= Object.freeze([...this.regionImages.keys()]);
  }

  regionsForImage(path: string): Region[] {
    return [...(this.regionImages.get(path) ?? [])].map(id => copy(this.regionsById.get(id)!));
  }

  private record(value: Region | Connection): string {
    let serialized = this.serializedRecords.get(value);
    if (serialized === undefined) { serialized = JSON.stringify(value); this.serializedRecords.set(value, serialized); }
    return serialized;
  }

  /** Cache unchanged records; yield during large cold serializations. Schema stays v1. */
  private async serialize(data: RegionData): Promise<string> {
    let start = performance.now();
    const serializeList = async (records: Array<Region | Connection>) => {
      const lines: string[] = [];
      for (let i = 0; i < records.length; i++) {
        lines.push(`    ${this.record(records[i])}`);
        if (i % 256 === 0 && performance.now() - start >= 8) { await new Promise<void>(resolve => window.setTimeout(resolve, 0)); start = performance.now(); }
      }
      return lines.length ? `[\n${lines.join(',\n')}\n  ]` : '[]';
    };
    const regions = await serializeList(data.regions), connections = await serializeList(data.connections);
    return `{\n  "version": 1,\n  "regions": ${regions},\n  "connections": ${connections}\n}\n`;
  }

  private connectionPaths(connection: Connection): Set<string> {
    const source = this.regionsById.get(connection.regionId)?.source;
    const paths = [connection.notePath, connection.captionPath, source?.path, source?.articlePath];
    const result = new Set<string>();
    for (const path of paths) {
      if (!path) continue;
      const parts = path.split('/');
      for (let length = 1; length <= parts.length; length++) result.add(parts.slice(0, length).join('/'));
    }
    return result;
  }

  private applyDelta(next: RegionData, delta: Delta): void {
    if (delta.regions?.length || delta.removedRegions?.length) this.imagePathsSnapshot = undefined;
    const updatedConnections = new Map((delta.connections ?? []).map(connection => [connection.id, connection]));
    const removedConnections = new Set(delta.removedConnections ?? []);
    const affected = new Set([...(delta.removedConnections ?? []), ...(delta.connections ?? []).map(connection => connection.id)]);
    for (const id of [...(delta.removedRegions ?? []), ...(delta.regions ?? []).map(region => region.id)]) {
      for (const connectionId of this.connectionsByRegion.get(id) ?? []) affected.add(connectionId);
    }
    for (const id of affected) {
      const before = this.connectionsById.get(id);
      if (before) {
        for (const path of this.connectionPaths(before)) removeFrom(this.connectionsByPath, path, id);
        const after = updatedConnections.get(id) ?? before;
        if (removedConnections.has(id) || after.regionId !== before.regionId) {
          removeFrom(this.connectionsByRegion, before.regionId, id);
        }
      }
    }
    for (const id of delta.removedRegions ?? []) {
      const before = this.regionsById.get(id);
      if (before) removeFrom(this.regionImages, before.source.path, id);
      this.regionsById.delete(id);
    }
    for (const region of delta.regions ?? []) {
      const before = this.regionsById.get(region.id);
      if (before && before.source.path !== region.source.path) removeFrom(this.regionImages, before.source.path, region.id);
      this.regionsById.set(region.id, region);
      addTo(this.regionImages, region.source.path, region.id);
    }
    for (const id of delta.removedConnections ?? []) this.connectionsById.delete(id);
    for (const connection of delta.connections ?? []) this.connectionsById.set(connection.id, connection);
    for (const id of affected) {
      const connection = this.connectionsById.get(id);
      if (connection) {
        addTo(this.connectionsByRegion, connection.regionId, id);
        for (const path of this.connectionPaths(connection)) addTo(this.connectionsByPath, path, id);
      }
      this.pendingChanges.add(id);
    }
    this.data = next;
  }

  /** Full comparison is reserved for externally replaced indexes, never a local edit. */
  private async adopt(next: RegionData): Promise<void> {
    if (next === this.data) return;
    const regions = new Map<string, Region>();
    const connections = new Map<string, Connection>();
    await eachBatched(next.regions, region => { regions.set(region.id, region); });
    await eachBatched(next.connections, connection => { connections.set(connection.id, connection); });
    const delta: Delta = { regions: [], connections: [], removedRegions: [], removedConnections: [] };
    let start = performance.now(), count = 0;
    const yieldIfNeeded = async () => {
      if (++count % 256 === 0 && performance.now() - start >= 8) { await new Promise<void>(resolve => window.setTimeout(resolve, 0)); start = performance.now(); }
    };
    for (const [id, region] of regions) {
      const before = this.regionsById.get(id);
      if (!before || this.record(before) !== this.record(region)) delta.regions!.push(region);
      await yieldIfNeeded();
    }
    for (const id of this.regionsById.keys()) { if (!regions.has(id)) delta.removedRegions!.push(id); await yieldIfNeeded(); }
    for (const [id, connection] of connections) {
      const before = this.connectionsById.get(id);
      if (!before || this.record(before) !== this.record(connection)) delta.connections!.push(connection);
      await yieldIfNeeded();
    }
    for (const id of this.connectionsById.keys()) { if (!connections.has(id)) delta.removedConnections!.push(id); await yieldIfNeeded(); }
    const changedRegions = new Set<Region>(), changedConnections = new Set<Connection>();
    await eachBatched(delta.regions ?? [], region => { changedRegions.add(region); });
    await eachBatched(delta.connections ?? [], connection => { changedConnections.add(connection); });
    // Retain immutable cached record identities after whitespace-only external edits.
    next = { version: 1, regions: await mapBatched(next.regions, region => this.regionsById.get(region.id) && !changedRegions.has(region) ? this.regionsById.get(region.id)! : region), connections: await mapBatched(next.connections, connection => this.connectionsById.get(connection.id) && !changedConnections.has(connection) ? this.connectionsById.get(connection.id)! : connection) };
    const changedIds = new Set<string>(), changedRegionIds = new Set<string>();
    await eachBatched(delta.removedConnections ?? [], id => { changedIds.add(id); });
    await eachBatched(delta.connections ?? [], connection => { changedIds.add(connection.id); });
    await eachBatched(delta.removedRegions ?? [], id => { changedRegionIds.add(id); });
    await eachBatched(delta.regions ?? [], region => { changedRegionIds.add(region.id); });
    for (const id of changedRegionIds) {
      for (const connectionId of this.connectionsByRegion.get(id) ?? []) { changedIds.add(connectionId); await yieldIfNeeded(); }
      await yieldIfNeeded();
    }
    // Build off to the side: readers see a complete previous snapshot until publication.
    const staging = new RegionStore(this.app);
    for (let offset = 0; offset < next.regions.length; offset += 128) {
      staging.applyDelta(next, { regions: next.regions.slice(offset, offset + 128) });
      if (performance.now() - start >= 8) { await new Promise<void>(resolve => window.setTimeout(resolve, 0)); start = performance.now(); }
    }
    for (let offset = 0; offset < next.connections.length; offset += 128) {
      const batch = next.connections.slice(offset, offset + 128);
      staging.applyDelta(next, { connections: batch });
      for (const connection of batch) if (changedRegionIds.has(connection.regionId)) changedIds.add(connection.id);
      if (performance.now() - start >= 8) { await new Promise<void>(resolve => window.setTimeout(resolve, 0)); start = performance.now(); }
    }
    this.data = next;
    this.regionsById = staging.regionsById;
    this.connectionsById = staging.connectionsById;
    this.connectionsByRegion = staging.connectionsByRegion;
    this.connectionsByPath = staging.connectionsByPath;
    this.regionImages = staging.regionImages;
    if (delta.regions?.length || delta.removedRegions?.length) this.imagePathsSnapshot = undefined;
    for (const id of changedIds) this.pendingChanges.add(id);
  }

  private async readDisk(): Promise<{ data: RegionData; raw: string | null }> {
    const file = this.app.vault.getAbstractFileByPath(INDEX);
    if (!file) return { data: { version: 1, regions: [], connections: [] }, raw: null };
    if (!isFile(file) || file.extension !== 'json') throw new Error('Image Annotation/index.json is not a regular file');
    const raw = await this.app.vault.read(file);
    if (this.loaded && raw === this.diskIndex) return { data: this.data, raw };
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error('Image Annotation/index.json is corrupt JSON'); }
    return { data: await validateData(value), raw };
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

function addTo(index: Map<string, Set<string>>, key: string, id: string): void {
  let ids = index.get(key); if (!ids) { ids = new Set(); index.set(key, ids); } ids.add(id);
}
function removeFrom(index: Map<string, Set<string>>, key: string, id: string): void {
  const ids = index.get(key); if (ids?.delete(id) && !ids.size) index.delete(key);
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

async function validateData(value: unknown): Promise<RegionData> {
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) throw new Error('Unsupported or corrupt Image Annotation index version');
  const candidate = value as { regions?: unknown; connections?: unknown };
  if (!Array.isArray(candidate.regions) || !Array.isArray(candidate.connections)) throw new Error('Corrupt Image Annotation index');
  const ids = new Set<string>();
  const regions = await mapBatched(candidate.regions, item => {
    const region = item as Region;
    if (!region || typeof region.id !== 'string' || !region.id || typeof region.created !== 'string') throw new Error('Corrupt region record');
    if (ids.has(region.id)) throw new Error('Duplicate Image Annotation record id');
    ids.add(region.id);
    return { id: region.id, title: validateTitle(region.title), source: validateSource(region.source), geometry: validateGeometry(region.geometry), created: region.created };
  });
  const connectionIds = new Set<string>();
  const connections = await mapBatched(candidate.connections, item => {
    const connection = item as Connection;
    if (!connection || typeof connection.id !== 'string' || !connection.id || !ids.has(connection.regionId) || typeof connection.created !== 'string') throw new Error('Corrupt connection record');
    if (ids.has(connection.id) || connectionIds.has(connection.id)) throw new Error('Duplicate Image Annotation record id');
    connectionIds.add(connection.id);
    const target = validateTarget(connection);
    return { id: connection.id, regionId: connection.regionId, notePath: target.notePath, ...(target.blockId ? { blockId: target.blockId } : {}), captionPath: validatePath(connection.captionPath, 'caption path'), created: connection.created };
  });
  return { version: 1, regions, connections };
}

/** Preserve collection order while splitting large validation/mapping tasks. */
async function eachBatched<T>(items: readonly T[], action: (item: T) => void): Promise<void> {
 let started = performance.now();
 for (let index = 0; index < items.length; index++) {
  action(items[index]);
  if (index % 256 === 255 && performance.now() - started >= 8) {
   await new Promise<void>(resolve => window.setTimeout(resolve, 0));
   started = performance.now();
  }
 }
}
async function mapBatched<T, U>(items: readonly T[], action: (item: T) => U): Promise<U[]> {
 const result: U[] = [];
 await eachBatched(items, item => { result.push(action(item)); });
 return result;
}

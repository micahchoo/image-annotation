import { App, TFile, normalizePath, type EventRef, type TAbstractFile } from 'obsidian';
import type { Region } from './types';

const MEDIA_ROOT = 'Image Annotation/Media';

export interface MediaCleanupCandidate {
  path: string;
  size: number;
}

export interface MediaCleanupReport {
  candidates: MediaCleanupCandidate[];
  protectedPaths: string[];
  unresolvedReferences: string[];
}

function imagePath(value: string): string {
  let result = value.trim().replace(/^<|>$/g, '').replace(/^\//, '');
  try { result = decodeURIComponent(result); } catch { /* Keep the literal path. */ }
  return normalizePath(result.split(/[?#]/, 1)[0]);
}

function isImagePath(path: string): boolean {
  return /\.(?:png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(path);
}

function isReferenceDocument(file: TFile): boolean {
  return ['md', 'canvas', 'json'].includes(file.extension.toLowerCase());
}

function isPluginSnapshot(file: TFile): boolean {
  return underMediaRoot(file.path) && /^[0-9a-f]{64}\.(?:png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name);
}

function references(text: string): string[] {
  const result: string[] = [];
  // Wiki links include ordinary note links as well as embeds. Protect both.
  for (const match of text.matchAll(/!?\[\[([^\]]+)\]\]/g)) {
    const target = match[1].split('|', 1)[0].split('#', 1)[0].split('^', 1)[0].trim();
    if (isImagePath(target)) result.push(target);
  }
  // Markdown links and image embeds can both point at an image.
  for (const match of text.matchAll(/!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)]*))/g)) {
    const target = (match[1] ?? match[2]).trim().split(/\s+\(?["']/, 1)[0];
    if (target && isImagePath(imagePath(target))) result.push(target);
  }
  // Reference-style Markdown destinations can encode even the snapshot basename.
  for (const match of text.matchAll(/^ {0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm)) {
    const target = match[1] ?? match[2];
    if (isImagePath(imagePath(target))) result.push(target);
  }
  for (const match of text.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    if (isImagePath(imagePath(match[1]))) result.push(match[1]);
  }
  return result;
}

function underMediaRoot(path: string): boolean {
  return path === MEDIA_ROOT || path.startsWith(`${MEDIA_ROOT}/`);
}

export type RegionUsage = readonly Region[] | readonly string[];

export interface MediaCleanupOptions {
  signal?: AbortSignal;
  onProgress?: (processed: number, total: number) => void;
}

/** Operation-scoped, conservative census. Once seen, a reference remains protected. */
class CleanupCensus {
  readonly protectedPaths = new Set<string>();
  readonly unresolved = new Set<string>();
  readonly media = new Map<string, TFile>();
  private byName = new Map<string, TFile[]>();
  private byPath = new Map<string, TFile>();
  private dirty = new Set<TFile>();
  private subscriptions: EventRef[] = [];
  private lastYield = performance.now();
  private scanned = 0;
  private total = 0;
  private editorText = new Map<string, string>();
  private regionUsage?: RegionUsage;
  revision = 0;

  constructor(private app: App, private options: MediaCleanupOptions) {}

  async checkpoint(): Promise<void> {
    this.options.signal?.throwIfAborted();
    if (performance.now() - this.lastYield >= 8) {
      this.options.onProgress?.(this.scanned, this.total);
      await new Promise<void>(resolve => window.setTimeout(resolve, 0));
      this.lastYield = performance.now();
      this.options.signal?.throwIfAborted();
    }
  }

  async start(): Promise<void> {
    // Subscribe before enumeration/reads: edits during the initial scan must be revisited.
    if (this.app.vault.on) {
      const changed = (file: TAbstractFile) => {
        this.revision++;
        if (file instanceof TFile) { this.addFile(file); if (isReferenceDocument(file)) this.dirty.add(file); }
      };
      this.subscriptions.push(this.app.vault.on('create', changed), this.app.vault.on('modify', changed), this.app.vault.on('rename', changed));
    }
    const documents: TFile[] = [];
    for (const file of this.app.vault.getFiles()) {
      this.addFile(file);
      if (isReferenceDocument(file)) documents.push(file);
      await this.checkpoint();
    }
    this.total = documents.length;
    for (const file of documents) {
      await this.read(file);
      this.scanned++;
      await this.checkpoint();
    }
    await this.refreshDocuments();
    this.options.onProgress?.(this.scanned, this.total);
  }

  close(): void {
    for (const reference of this.subscriptions) this.app.vault.offref(reference);
    this.subscriptions = [];
  }

  private addFile(file: TFile): void {
    if (this.byPath.get(file.path) === file) return;
    this.byPath.set(file.path, file);
    const sameName = this.byName.get(file.name) ?? [];
    if (!sameName.includes(file)) sameName.push(file);
    this.byName.set(file.name, sameName);
    if (isPluginSnapshot(file)) this.media.set(file.path, file);
  }

  private protectText(text: string, sourcePath: string): void {
    // One token pass replaces the former documents × snapshots regex cross-product.
    for (const token of text.matchAll(/(?:^|[^A-Za-z0-9._-])([0-9a-f]{64}\.(?:png|jpe?g|webp|gif|bmp|avif))(?=$|[^A-Za-z0-9._-])/gi)) {
      for (const file of this.byName.get(token[1]) ?? []) this.protectedPaths.add(file.path);
    }
    for (const reference of references(text)) {
      const requested = imagePath(reference);
      const linked = this.app.metadataCache.getFirstLinkpathDest(requested, sourcePath);
      const exact = this.byPath.get(requested);
      const matches = linked instanceof TFile ? [linked] : exact ? [exact] : this.byName.get(requested.split('/').pop() ?? '') ?? [];
      if (matches.length) for (const file of matches) this.protectedPaths.add(file.path);
      else this.unresolved.add(requested);
    }
  }

  private async read(file: TFile): Promise<void> {
    // A read failure aborts cleanup; inability to prove non-use must never trash a file.
    if (this.app.vault.getAbstractFileByPath(file.path) !== file) return;
    this.protectText(await this.app.vault.cachedRead(file), file.path);
  }

  async refreshDocuments(): Promise<void> {
    while (this.dirty.size) {
      const changed = [...this.dirty]; this.dirty.clear();
      for (const file of changed) { await this.read(file); await this.checkpoint(); }
    }
  }

  protectLive(regions: RegionUsage): void {
    if (regions !== this.regionUsage) {
      for (const region of regions) this.protectedPaths.add(normalizePath(typeof region === 'string' ? region : region.source.path));
      // Only immutable path snapshots may be reused; callers can mutate Region arrays.
      this.regionUsage = Object.isFrozen(regions) && (regions.length === 0 || typeof regions[0] === 'string') ? regions : undefined;
    }
    for (const leaf of this.app.workspace?.getLeavesOfType?.('markdown') ?? []) {
      const view = leaf.view as { file?: TFile; editor?: { getValue(): string } };
      if (view.file && view.editor) {
        const text = view.editor.getValue();
        if (this.editorText.get(view.file.path) !== text) {
          this.protectText(text, view.file.path);
          this.editorText.set(view.file.path, text);
        }
      }
    }
  }

  report(): MediaCleanupReport {
    const unresolvedNames = new Set([...this.unresolved].map(path => path.split('/').pop()));
    return {
      candidates: [...this.media.values()].filter(file => !this.protectedPaths.has(file.path) && !unresolvedNames.has(file.name)).map(file => ({path:file.path,size:file.stat.size})),
      protectedPaths: [...this.protectedPaths].sort(),
      unresolvedReferences: [...this.unresolved].sort(),
    };
  }

  isProtected(file: TFile): boolean {
    if (this.protectedPaths.has(file.path)) return true;
    for (const path of this.unresolved) if (path.split('/').pop() === file.name) return true;
    return false;
  }
}

export async function scanMediaCleanup(app: App, regions: RegionUsage, options: MediaCleanupOptions = {}): Promise<MediaCleanupReport> {
  const census = new CleanupCensus(app, options);
  try { await census.start(); census.protectLive(regions); return census.report(); }
  finally { census.close(); }
}

type RegionSource = RegionUsage | (() => RegionUsage | Promise<RegionUsage>);
async function currentRegions(source: RegionSource): Promise<RegionUsage> {
  return typeof source === 'function' ? await source() : source;
}

/** Revalidate changes and live state immediately before each trash operation. */
export async function trashUnusedMedia(app: App, regions: RegionSource, approvedPaths?: readonly string[], options: MediaCleanupOptions = {}): Promise<MediaCleanupCandidate[]> {
  const census = new CleanupCensus(app, options);
  try {
    await census.start();
    census.protectLive(await currentRegions(regions));
    const reviewed = new Set(approvedPaths ?? census.report().candidates.map(candidate => candidate.path));
    const trashed: MediaCleanupCandidate[] = [];
    for (const path of reviewed) {
      await census.checkpoint();
      // The provider can itself await disk I/O. Drain changes after it resolves.
      let observed: number;
      let current: RegionUsage;
      do {
        observed = census.revision;
        current = await currentRegions(regions);
        await census.refreshDocuments();
        options.signal?.throwIfAborted();
      } while (observed !== census.revision);
      // No await between the final epoch check, live editor snapshot, and trash call.
      census.protectLive(current);
      options.signal?.throwIfAborted();
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile) || !isPluginSnapshot(file) || census.isProtected(file)) continue;
      const removed = {path:file.path,size:file.stat.size};
      await app.fileManager.trashFile(file);
      trashed.push(removed);
    }
    return trashed;
  } finally { census.close(); }
}

export const findUnusedMedia = scanMediaCleanup;

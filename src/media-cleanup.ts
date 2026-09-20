import { App, TFile, normalizePath } from 'obsidian';
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
  for (const match of text.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    if (isImagePath(imagePath(match[1]))) result.push(match[1]);
  }
  return result;
}

function underMediaRoot(path: string): boolean {
  return path === MEDIA_ROOT || path.startsWith(`${MEDIA_ROOT}/`);
}

function resolveReference(app: App, reference: string, sourcePath: string, files: TFile[]): TFile[] {
  const requested = imagePath(reference);
  const linked = app.metadataCache.getFirstLinkpathDest(requested, sourcePath);
  if (linked instanceof TFile) return [linked];
  const exact = files.filter(file => file.path === requested);
  if (exact.length) return exact;
  // An unresolved basename can refer to multiple attachments. Protect all of
  // them; deleting one would make the result depend on link resolution order.
  const basename = requested.split('/').pop();
  return basename ? files.filter(file => file.name === basename) : [];
}

/** Find unreferenced plugin snapshots. The result is a reviewable snapshot. */
export async function scanMediaCleanup(app: App, regions: readonly Region[]): Promise<MediaCleanupReport> {
  const files = app.vault.getFiles();
  const mediaFiles = files.filter(isPluginSnapshot);
  const protectedPaths = new Set<string>();
  const unresolved = new Set<string>();

  for (const region of regions) {
    const source = app.vault.getAbstractFileByPath(normalizePath(region.source.path));
    if (source instanceof TFile) protectedPaths.add(source.path);
    else protectedPaths.add(normalizePath(region.source.path));
  }
  for (const note of files.filter(isReferenceDocument)) {
    const text = await app.vault.cachedRead(note);
    // A raw basename mention may be a canvas or a syntax variant we do not
    // understand. Protect it rather than guessing that it is unused.
    for (const media of mediaFiles) if (new RegExp(`(?:^|[^A-Za-z0-9._-])${escapeRegExp(media.name)}(?:$|[^A-Za-z0-9._-])`).test(text)) protectedPaths.add(media.path);
    for (const reference of references(text)) {
      const resolved = resolveReference(app, reference, note.path, files);
      if (resolved.length) resolved.forEach(file => protectedPaths.add(file.path));
      else unresolved.add(imagePath(reference));
    }
  }
  // The editor may contain changes that are not on disk yet. A reference in
  // any open Markdown view is enough to protect the matching snapshot.
  const leaves = app.workspace?.getLeavesOfType?.('markdown') ?? [];
  for (const leaf of leaves) {
    const view = leaf.view as { file?: TFile; editor?: { getValue(): string } };
    if (!view.file || !view.editor) continue;
    const text = view.editor.getValue();
    for (const media of mediaFiles) if (new RegExp(`(?:^|[^A-Za-z0-9._-])${escapeRegExp(media.name)}(?:$|[^A-Za-z0-9._-])`).test(text)) protectedPaths.add(media.path);
    for (const reference of references(text)) {
      const resolved = resolveReference(app, reference, view.file.path, files);
      if (resolved.length) resolved.forEach(file => protectedPaths.add(file.path));
      else unresolved.add(imagePath(reference));
    }
  }

  const unresolvedBasenames = new Set([...unresolved].map(path => path.split('/').pop()));
  const candidates = mediaFiles
    .filter(file => !protectedPaths.has(file.path) && !unresolvedBasenames.has(file.name))
    .map(file => ({ path: file.path, size: file.stat.size }));
  return { candidates, protectedPaths: [...protectedPaths].sort(), unresolvedReferences: [...unresolved].sort() };
}

/** Re-scan immediately before trashing, then use Obsidian's file manager. */
type RegionSource = readonly Region[] | (() => readonly Region[] | Promise<readonly Region[]>);
async function currentRegions(source: RegionSource): Promise<readonly Region[]> {
  return typeof source === 'function' ? await source() : source;
}

export async function trashUnusedMedia(app: App, regions: RegionSource, approvedPaths?: readonly string[]): Promise<MediaCleanupCandidate[]> {
  const first = await scanMediaCleanup(app, await currentRegions(regions));
  const reviewed = new Set(approvedPaths ?? first.candidates.map(candidate => candidate.path));
  const trashed: MediaCleanupCandidate[] = [];
  for (const candidate of first.candidates) {
    if (!reviewed.has(candidate.path)) continue;
    const current = await scanMediaCleanup(app, await currentRegions(regions));
    if (!current.candidates.some(item => item.path === candidate.path)) continue;
    const file = app.vault.getAbstractFileByPath(candidate.path);
    if (!(file instanceof TFile) || !underMediaRoot(file.path)) continue;
    await app.fileManager.trashFile(file);
    trashed.push({ path: file.path, size: file.stat.size });
  }
  return trashed;
}

export const findUnusedMedia = scanMediaCleanup;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

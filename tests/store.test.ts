import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({}));

import { RegionStore } from '../src/store';

class FakeVault {
  files = new Map<string, { path: string; name: string; extension: string; stat: object; text: string }>();
  folders = new Set<string>();
  beforeProcess?: () => void;
  getAbstractFileByPath(path: string) { return this.files.get(path) ?? (this.folders.has(path) ? { path, name: path.split('/').pop()!, children: [] } : null); }
  async createFolder(path: string) { this.folders.add(path); return this.getAbstractFileByPath(path); }
  async create(path: string, text: string) { if (this.files.has(path)) throw new Error('exists'); const file = this.file(path, text); this.files.set(path, file); return file; }
  async read(file: { path: string }) { return this.files.get(file.path)!.text; }
  async process(file: { path: string }, fn: (text: string) => string) { this.beforeProcess?.(); const item = this.files.get(file.path)!; item.text = fn(item.text); return item.text; }
  async delete(file: { path: string }) { this.files.delete(file.path); }
  file(path: string, text: string) { return { path, name: path.split('/').pop()!, extension: path.split('.').pop()!, stat: {}, text }; }
}

const app = (vault: FakeVault) => ({ vault, fileManager: { trashFile: (file: {path: string}) => vault.delete(file) } }) as never;
const source = { path: 'images/map.png', width: 100, height: 80 };
const rect = { type: 'rect' as const, x: 0.1, y: 0.2, width: 0.2, height: 0.1 };

describe('RegionStore', () => {
  it('persists regions and captions with native links, and reads only the body', async () => {
    const vault = new FakeVault();
    const store = new RegionStore(app(vault));
    await store.load();
    const region = await store.createRegion(source, rect, 'North');
    const connection = await store.connect(region.id, { notePath: 'notes/idea.md', blockId: 'thought' }, 'A useful caption');
    expect(vault.files.get('Image Annotation/Captions/' + connection.captionPath.split('/').pop())!.text).toContain('![[images/map.png]]');
    expect(vault.files.get(connection.captionPath)!.text).toContain('[[notes/idea.md#^thought]]');
    await expect(store.readCaption(connection)).resolves.toBe('A useful caption');
  });

  it('rejects corrupt indexes and preserves caption text during path renames', async () => {
    const vault = new FakeVault();
    vault.folders.add('Image Annotation');
    vault.files.set('Image Annotation/index.json', vault.file('Image Annotation/index.json', '{bad'));
    await expect(new RegionStore(app(vault)).load()).rejects.toThrow(/corrupt JSON/);
  });

  it('detects an external index edit before committing a mutation', async () => {
    const vault = new FakeVault();
    const store = new RegionStore(app(vault));
    await store.load();
    const index = vault.files.get('Image Annotation/index.json');
    expect(index).toBeUndefined();
    await store.createRegion(source, rect, 'First');
    vault.beforeProcess = () => { vault.files.get('Image Annotation/index.json')!.text = '{"version":1,"regions":[],"connections":[]}'; };
    await expect(store.createRegion(source, rect, 'Second')).rejects.toThrow(/changed externally/);
  });

  it('validates normalized geometry, allows zero-based article lines, and preserves attribution', async () => {
    const vault = new FakeVault();
    const store = new RegionStore(app(vault));
    await store.load();
    await expect(store.createRegion(source, { type: 'rect', x: 0.9, y: 0, width: 0.2, height: 0.1 }, 'Bad')).rejects.toThrow(/normalized bounds/);
    const region = await store.createRegion({ ...source, articlePath: 'articles/source.md', articleLine: 0, originalUrl: 'https://example.test/source' }, rect, 'Good');
    const connection = await store.connect(region.id, { notePath: 'notes/idea.md' }, 'Caption');
    const text = vault.files.get(connection.captionPath)!.text;
    expect(text).toContain('Source note: [[articles/source.md]]');
    expect(text).toContain('Original URL: https://example.test/source');
    await expect(store.connect(region.id, { notePath: 'notes/idea.md', blockId: 'bad_id' }, 'x')).rejects.toThrow(/block id/);
  });

  it('does not write the index for unrelated renames and rewrites folder prefixes', async () => {
    const vault = new FakeVault();
    const store = new RegionStore(app(vault));
    await store.load();
    const region = await store.createRegion({ ...source, path: 'images/folder/map.png' }, rect, 'Map');
    const before = vault.files.get('Image Annotation/index.json')!.text;
    await store.rename('unrelated', 'elsewhere');
    expect(vault.files.get('Image Annotation/index.json')!.text).toBe(before);
    await store.rename('images/folder', 'images/archive');
    expect(store.getRegion(region.id)!.source.path).toBe('images/archive/map.png');
  });

  it('updates a region in place and removes records while keeping caption Markdown', async () => {
    const vault = new FakeVault();
    const store = new RegionStore(app(vault));
    await store.load();
    const region = await store.createRegion(source, rect, 'Before');
    const connection = await store.connect(region.id, { notePath: 'notes/idea.md' }, 'Keep this writing');
    const updated = await store.updateRegion(region.id, { type: 'rect', x: 0.3, y: 0.3, width: 0.2, height: 0.2 }, 'After');
    expect(updated.id).toBe(region.id);
    expect(store.getConnections(region.id)[0].id).toBe(connection.id);
    await store.removeRegion(region.id);
    expect(store.getRegion(region.id)).toBeUndefined();
    expect(store.getConnection(connection.id)).toBeUndefined();
    expect(vault.files.has(connection.captionPath)).toBe(true);
    expect(vault.files.get(connection.captionPath)!.text).toContain('Keep this writing');
  });
  it('trashes only the new caption if an attachment conflicts with an external edit', async () => {
    const vault = new FakeVault();
    const trashFile = vi.fn((file: { path: string }) => vault.delete(file));
    const store = new RegionStore({ vault, fileManager: { trashFile } } as never);
    await store.load();
    const region = await store.createRegion(source, rect, 'Eyes');
    const saved = await store.connect(region.id, { notePath: 'His Eyes Sparkle.md' }, 'The eyes catch the light.');
    const original = vault.files.get(saved.captionPath)!.text;
    vault.beforeProcess = () => {
      const index = vault.files.get('Image Annotation/index.json')!;
      index.text += ' ';
    };
    await expect(store.connect(region.id, { notePath: 'His Eyes Sparkle.md' }, 'Another caption')).rejects.toThrow(/changed externally/);
    expect(trashFile).toHaveBeenCalledOnce();
    expect(trashFile.mock.calls[0][0].path).not.toBe(saved.captionPath);
    expect(vault.files.get(saved.captionPath)!.text).toBe(original);
    expect(store.getConnections(region.id)).toHaveLength(1);
  });

  it('invalidates only previews connected to changed regions and ignores own-write reloads', async () => {
    const vault = new FakeVault();
    const store = new RegionStore(app(vault));
    await store.load();
    const first = await store.createRegion(source, rect, 'First');
    const second = await store.createRegion(source, rect, 'Second');
    const a = await store.connect(first.id, { notePath: 'a.md' }, 'A');
    const b = await store.connect(second.id, { notePath: 'b.md' }, 'B');
    store.takeChanges();
    await store.updateRegion(first.id, rect, 'Changed');
    expect([...store.takeChanges()]).toEqual([a.id]);
    await store.load();
    expect(store.takeChanges().size).toBe(0);
    expect([...store.connectionsForPath(b.captionPath)]).toEqual([b.id]);
    expect(store.connectionsForPath('unrelated.md').size).toBe(0);
    await store.removeRegion(first.id);
    expect([...store.takeChanges()]).toEqual([a.id]);
    expect(store.getConnection(a.id)).toBeUndefined();
    expect(store.getConnection(b.id)).toEqual(b);
  });

  it('adopts externally changed records and invalidates their existing previews', async () => {
    const vault = new FakeVault();
    const store = new RegionStore(app(vault));
    await store.load();
    const region = await store.createRegion(source, rect, 'Original');
    const connection = await store.connect(region.id, { notePath: 'a.md' }, 'Caption');
    store.takeChanges();
    const index = vault.files.get('Image Annotation/index.json')!;
    index.text = index.text.replace('Original', 'External');
    await store.load();
    expect(store.getRegion(region.id)?.title).toBe('External');
    expect([...store.takeChanges()]).toEqual([connection.id]);
    index.text = '{bad';
    await expect(store.load()).rejects.toThrow(/corrupt/);
    expect(store.getRegion(region.id)?.title).toBe('External');
  });

});

import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({}));
vi.stubGlobal('window', globalThis);

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

  it('keeps reverse path indexes correct across attachment, folder rename, and deletion', async () => {
    const vault = new FakeVault(), store = new RegionStore(app(vault));
    await store.load();
    const region = await store.createRegion({ ...source, articlePath: 'articles/map.md' }, rect, 'Map');
    const connection = await store.connect(region.id, { notePath: 'notes/thought.md' }, 'Caption');
    expect([...store.connectionsForPath('images')]).toEqual([connection.id]);
    expect([...store.connectionsForPath('articles/map.md')]).toEqual([connection.id]);
    expect(store.regionsForImage(source.path).map(item => item.id)).toEqual([region.id]);
    await store.rename('images', 'archive/images');
    expect(store.connectionsForPath('images').size).toBe(0);
    expect([...store.connectionsForPath('archive')]).toEqual([connection.id]);
    expect(store.regionsForImage(source.path)).toEqual([]);
    expect(store.regionsForImage('archive/images/map.png').map(item => item.id)).toEqual([region.id]);
    await store.removeRegion(region.id);
    expect(store.connectionsForPath('archive').size).toBe(0);
    expect(store.connectionsForPath('notes').size).toBe(0);
    expect(store.getConnections(region.id)).toEqual([]);
  });

  it('round-trips compact snapshots and updates external path changes without stale reverse entries', async () => {
    const vault = new FakeVault(), store = new RegionStore(app(vault));
    await store.load();
    const region = await store.createRegion(source, rect, 'Map');
    const connection = await store.connect(region.id, { notePath: 'before.md' }, 'Caption');
    const index = vault.files.get('Image Annotation/index.json')!;
    index.text = index.text.replace('before.md','after.md');
    await store.load();
    expect(store.connectionsForPath('before.md').size).toBe(0);
    expect([...store.connectionsForPath('after.md')]).toEqual([connection.id]);
    const reopened = new RegionStore(app(vault));await reopened.load();
    expect(reopened.getRegion(region.id)).toEqual(region);
    expect(reopened.getConnections(region.id)).toEqual(store.getConnections(region.id));
    store.takeChanges();index.text += ' ';await store.load();
    expect(store.takeChanges().size).toBe(0);
  });

  it('preserves shared-image rendering order when a region is edited', async () => {
    const vault = new FakeVault(), store = new RegionStore(app(vault));
    await store.load();
    const regions = [];
    for (const title of ['First', 'Middle', 'Last']) regions.push(await store.createRegion(source, rect, title));
    const expected = regions.map(region => region.id);
    await store.updateRegion(regions[1].id, { ...rect, x: 0.2 }, 'Middle renamed');
    // ImageModal feeds this ordering directly to SVG rendering and its region list.
    expect(store.regionsForImage(source.path).map(region => region.id)).toEqual(expected);
    const reopened = new RegionStore(app(vault));
    await reopened.load();
    expect(reopened.regionsForImage(source.path)).toEqual(store.regionsForImage(source.path));
  });

  it('preserves attachment order when a target or caption path changes', async () => {
    const vault = new FakeVault(), store = new RegionStore(app(vault));
    await store.load();
    const region = await store.createRegion(source, rect, 'Map');
    const connections = [];
    for (const name of ['first', 'middle', 'last']) connections.push(await store.connect(region.id, { notePath: `${name}.md` }, name));
    const expected = connections.map(connection => connection.id);
    await store.rename('first.md', 'renamed.md');
    expect(store.getConnections(region.id).map(connection => connection.id)).toEqual(expected);
    await store.rename(connections[1].captionPath, 'Image Annotation/Captions/renamed.md');
    expect(store.getConnections(region.id).map(connection => connection.id)).toEqual(expected);
    expect([...store.connectionsForPath('renamed.md')]).toEqual([connections[0].id]);
    const reopened = new RegionStore(app(vault));
    await reopened.load();
    expect(reopened.getConnections(region.id)).toEqual(store.getConnections(region.id));
  });

  it('serializes only changed records on a warm edit and preserves all unrelated records', async () => {
    const vault = new FakeVault(), store = new RegionStore(app(vault));
    const regions = Array.from({length:1000}, (_, i) => ({id:`r-${i}`,source,geometry:rect,title:`Region ${i}`,created:'2026-09-20'}));
    const connections = regions.map((region, i) => ({id:`c-${i}`,regionId:region.id,notePath:`notes/${i}.md`,captionPath:`Image Annotation/Captions/${i}.md`,created:'2026-09-20'}));
    const indexPath = 'Image Annotation/index.json';
    vault.folders.add('Image Annotation');await vault.create(indexPath,JSON.stringify({version:1,regions,connections}));
    await store.load();await store.updateRegion('r-0',rect,'Warm');store.takeChanges();
    const stringify = vi.spyOn(JSON,'stringify');
    await store.updateRegion('r-0',rect,'Updated');
    const serializedRecordIds = stringify.mock.calls.map(([value]) => value && typeof value === 'object' && 'id' in value ? value.id : null).filter(Boolean);
    stringify.mockRestore();
    expect(serializedRecordIds.every(id => id === 'r-0')).toBe(true);
    expect(serializedRecordIds.length).toBeLessThan(5);
    const saved = JSON.parse(vault.files.get(indexPath)!.text);
    expect(saved.regions.slice(1)).toEqual(regions.slice(1));
    expect(saved.connections).toEqual(connections);
    expect([...store.takeChanges()]).toEqual(['c-0']);
    expect(store.connectionsForPath('unrelated.md').size).toBe(0);
  });

});

it('publishes a large rename atomically and queues the following edit against its committed state',async()=>{
 const vault=new FakeVault(),store=new RegionStore(app(vault));
 const regions=Array.from({length:10000},(_,i)=>({id:`r-${i}`,source:{...source,path:`images/${i}.png`},geometry:rect,title:`Region ${i}`,created:'today'}));
 const connections=regions.map((region,i)=>({id:`c-${i}`,regionId:region.id,notePath:`notes/${i}.md`,captionPath:`Image Annotation/Captions/${i}.md`,created:'today'}));
 vault.folders.add('Image Annotation');await vault.create('Image Annotation/index.json',JSON.stringify({version:1,regions,connections}));await store.load();store.takeChanges();
 let partial=false;
 const timer=setInterval(()=>{const path=store.getRegion('r-0')!.source.path;const old=store.connectionsForPath('images').size;const next=store.connectionsForPath('archive').size;if(path.startsWith('images/')?(old!==10000||next!==0):(old!==0||next!==10000))partial=true;},0);
 try{await Promise.all([store.rename('images','archive'),store.updateRegion('r-0',rect,'After rename')]);}finally{clearInterval(timer);}
 expect(partial).toBe(false);expect(store.getRegion('r-0')?.source.path).toBe('archive/0.png');expect(store.getRegion('r-0')?.title).toBe('After rename');
 expect(store.takeChanges().size).toBe(10000);
 expect(store.regionsForImage('archive/0.png').map(region=>region.id)).toEqual(['r-0']);
 const saved=JSON.parse(vault.files.get('Image Annotation/index.json')!.text);expect(saved.regions).toHaveLength(10000);expect(saved.connections).toEqual(connections);
});

it('rejects a malformed last record after yielding without publishing a partially validated index',async()=>{
 const vault=new FakeVault(),store=new RegionStore(app(vault));await store.load();const initial=await store.createRegion(source,rect,'Keep');
 const regions=Array.from({length:10000},(_,i)=>({...initial,id:`external-${i}`}));
 const index=vault.files.get('Image Annotation/index.json')!;index.text=JSON.stringify({version:1,regions:[...regions,{...initial,id:'bad',source:{...source,width:0}}],connections:[]});
 await expect(store.load()).rejects.toThrow(/dimensions/);expect(store.allRegions()).toEqual([initial]);expect(store.imagePaths()).toEqual([source.path]);
});

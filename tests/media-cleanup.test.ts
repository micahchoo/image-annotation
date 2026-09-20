import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  TFile: class TFile {},
  normalizePath: (path: string) => path,
}));

import { TFile } from 'obsidian';
import { scanMediaCleanup, trashUnusedMedia } from '../src/media-cleanup';

function file(path: string, text = '', size = 3): TFile {
  const result = Object.assign(new TFile(), {
    path, name: path.split('/').pop(), extension: path.split('.').pop(),
    stat: { size }, text,
  });
  return result;
}

function app(files: TFile[]) {
  const byPath = new Map(files.map(item => [item.path, item]));
  return {
    vault: {
      getFiles: () => files,
      getAbstractFileByPath: (path: string) => byPath.get(path),
      cachedRead: async (item: TFile) => (item as TFile & { text: string }).text,
    },
    metadataCache: { getFirstLinkpathDest: (path: string) => byPath.get(path) },
    workspace: { getLeavesOfType: () => [] },
    fileManager: { trashFile: vi.fn(async (item: TFile) => { byPath.delete(item.path); }) },
  } as never;
}

describe('media cleanup', () => {
  it('protects regions and image links in ordinary notes and captions', async () => {
    const source = file('Image Annotation/Media/' + 'a'.repeat(64) + '.png');
    const orphan = file('Image Annotation/Media/' + 'b'.repeat(64) + '.png');
    const note = file('notes/note.md', `![[${source.path}]]\n[linked](../${orphan.path})`);
    const result = await scanMediaCleanup(app([source, orphan, note]), [{ source: { path: source.path } }] as never);
    expect(result.candidates.map(item => item.path)).toEqual([]);
  });

  it('skips an unresolved image basename and rechecks before trashing', async () => {
    const orphan = file('Image Annotation/Media/' + 'b'.repeat(64) + '.png');
    const note = file('notes/note.md', '![[missing.png]]');
    const application = app([orphan, note]);
    const result = await scanMediaCleanup(application, []);
    expect(result.candidates.map(item => item.path)).toEqual([orphan.path]);
    expect(result.unresolvedReferences).toEqual(['missing.png']);
    await expect(trashUnusedMedia(application, [])).resolves.toEqual([{ path: orphan.path, size: 3 }]);
    expect((application as { fileManager: { trashFile: ReturnType<typeof vi.fn> } }).fileManager.trashFile).toHaveBeenCalledOnce();
  });

  it('protects references in an unsaved Markdown editor buffer', async () => {
    const image = file('Image Annotation/Media/' + 'c'.repeat(64) + '.png');
    const note = file('notes/live.md');
    const application = app([image, note]) as never as { vault: unknown; metadataCache: unknown; workspace: unknown; fileManager: unknown };
    application.workspace = { getLeavesOfType: () => [{ view: { file: note, editor: { getValue: () => `![[${image.path}]]` } } }] };
    const result = await scanMediaCleanup(application as never, []);
    expect(result.candidates).toEqual([]);
  });

  it('trashes only reviewed paths and rechecks a fresh region provider', async () => {
    const image = file('Image Annotation/Media/' + 'd'.repeat(64) + '.png');
    const application = app([image]);
    const report = await scanMediaCleanup(application, []);
    await expect(trashUnusedMedia(application, [{ source: { path: image.path } }] as never, report.candidates.map(item => item.path))).resolves.toEqual([]);
    const other = file('Image Annotation/Media/' + 'e'.repeat(64) + '.png');
    const application2 = app([other]);
    const regions = [{ source: { path: other.path } }] as never;
    await expect(trashUnusedMedia(application2, () => regions, [])).resolves.toEqual([]);
  });
  it('protects reference-style Markdown and canvas links while ignoring non-plugin files', async () => {
    const a = file('Image Annotation/Media/' + 'a'.repeat(64) + '.png');
    const b = file('Image Annotation/Media/' + 'b'.repeat(64) + '.png');
    const ordinary = file('Image Annotation/Media/my-image.png');
    const markdown = file('note.md', `![Photo][source]\n[source]: <${a.path}>`);
    const canvas = file('board.canvas', JSON.stringify({nodes:[{type:'file',file:b.path}]}));
    expect((await scanMediaCleanup(app([a,b,ordinary,markdown,canvas]), [])).candidates).toEqual([]);
  });

  it('does not trash a snapshot first referenced after the review', async () => {
    const image = file('Image Annotation/Media/' + 'f'.repeat(64) + '.png');
    const note = file('note.md');
    const application = app([image,note]);
    const reviewed = (await scanMediaCleanup(application, [])).candidates.map(item=>item.path);
    Object.assign(note,{text:`![[${image.path}]]`});
    expect(await trashUnusedMedia(application, [], reviewed)).toEqual([]);
  });

  it('only trashes approved candidates even when other unused files exist', async () => {
    const a = file('Image Annotation/Media/' + 'a'.repeat(64) + '.png');
    const b = file('Image Annotation/Media/' + 'b'.repeat(64) + '.png');
    expect(await trashUnusedMedia(app([a,b]), [], [a.path])).toEqual([{path:a.path,size:3}]);
  });

  it('keeps a snapshot attached between the two cleanup scans', async () => {
    const image = file('Image Annotation/Media/' + 'a'.repeat(64) + '.png');
    let calls=0;
    const provider=()=>++calls===1?[]:[{source:{path:image.path}}] as never;
    expect(await trashUnusedMedia(app([image]), provider, [image.path])).toEqual([]);
    expect(calls).toBe(2);
  });

});

// A fake event bus exercises edits occurring after the initial safety census.
function changingApp(files: TFile[]) {
  const application = app(files) as never as {
    vault: {getFiles():TFile[];getAbstractFileByPath(path:string):TFile|undefined;cachedRead(file:TFile):Promise<string>;on(name:string,fn:(file:TFile)=>void):unknown;offref(ref:unknown):void};
    fileManager: {trashFile:ReturnType<typeof vi.fn>};
  };
  const subscriptions = new Set<{name:string;fn:(file:TFile)=>void}>();
  application.vault.on = (name,fn) => {const ref={name,fn};subscriptions.add(ref);return ref;};
  application.vault.offref = ref => {subscriptions.delete(ref as never);};
  const emit = (name:string,file:TFile) => {for(const ref of subscriptions)if(ref.name===name)ref.fn(file);};
  const read = vi.spyOn(application.vault,'cachedRead');
  return {application,emit,read,subscriptions};
}

it('reads unchanged documents once and revisits a newly referenced document before trash', async () => {
  vi.stubGlobal('window',globalThis);
  const images = Array.from({length:20},(_,i)=>file(`Image Annotation/Media/${i.toString(16).padStart(64,'0')}.png`));
  const note = file('note.md');
  const {application,emit,read,subscriptions} = changingApp([...images,note]);
  let calls=0;
  const provider=()=>{
    if(++calls===3){Object.assign(note,{text:`![[${images[1].path}]]`});emit('modify',note);}
    return [];
  };
  const removed=await trashUnusedMedia(application as never,provider);
  expect(removed).toHaveLength(19);
  expect(removed.map(item=>item.path)).not.toContain(images[1].path);
  expect(read).toHaveBeenCalledTimes(2);
  expect(subscriptions.size).toBe(0);
});

it('keeps an unsaved reference added during cleanup and releases listeners on cancellation', async () => {
  vi.stubGlobal('window',globalThis);
  const image=file('Image Annotation/Media/'+'a'.repeat(64)+'.png'),note=file('note.md');
  const {application,subscriptions}=changingApp([image,note]);
  let text='',calls=0;
  Object.assign(application,{workspace:{getLeavesOfType:()=>[{view:{file:note,editor:{getValue:()=>text}}}]}});
  expect(await trashUnusedMedia(application as never,()=>{if(++calls===2)text=`![[${image.path}]]`;return [];})).toEqual([]);
  const controller=new AbortController();controller.abort();
  await expect(trashUnusedMedia(application as never,[],undefined,{signal:controller.signal})).rejects.toThrow();
  expect(subscriptions.size).toBe(0);
});

it('fails closed on document read errors and honors cancellation between trash operations', async () => {
  vi.stubGlobal('window',globalThis);
  const images=['a','b'].map(char=>file('Image Annotation/Media/'+char.repeat(64)+'.png'));
  const note=file('note.md');
  const first=changingApp([...images,note]);first.read.mockRejectedValue(new Error('read denied'));
  await expect(trashUnusedMedia(first.application as never,[])).rejects.toThrow('read denied');
  expect(first.application.fileManager.trashFile).not.toHaveBeenCalled();
  expect(first.subscriptions.size).toBe(0);
  const second=changingApp(images);const controller=new AbortController();
  second.application.fileManager.trashFile.mockImplementation(async()=>controller.abort());
  await expect(trashUnusedMedia(second.application as never,[],undefined,{signal:controller.signal})).rejects.toThrow();
  expect(second.application.fileManager.trashFile).toHaveBeenCalledTimes(1);
  expect(second.subscriptions.size).toBe(0);
});

it('keeps a newly created document reference and does not broaden reviewed paths', async()=>{
  vi.stubGlobal('window',globalThis);
  const image=file('Image Annotation/Media/'+'a'.repeat(64)+'.png');
  const note=file('new.canvas',JSON.stringify({file:image.path}));
  const {application,emit}=changingApp([image]);
  const original=application.vault.getAbstractFileByPath;
  application.vault.getAbstractFileByPath=path=>path===note.path?note:original(path);
  let calls=0;
  expect(await trashUnusedMedia(application as never,()=>{if(++calls===2)emit('create',note);return [];},[image.path])).toEqual([]);
});

it('bounds a large cleanup to one read per unchanged document and yields to the event loop', async()=>{
  vi.stubGlobal('window',globalThis);
  const images=Array.from({length:1000},(_,i)=>file(`Image Annotation/Media/${i.toString(16).padStart(64,'0')}.png`));
  const notes=Array.from({length:10000},(_,i)=>file(`notes/${i}.md`,'ordinary prose '.repeat(100)));
  const {application,read,subscriptions}=changingApp([...images,...notes]);
  let timerRan=false;const timer=setTimeout(()=>{timerRan=true;},0);
  const removed=await trashUnusedMedia(application as never,[]);
  clearTimeout(timer);
  expect(removed).toHaveLength(1000);
  expect(read).toHaveBeenCalledTimes(notes.length);
  expect(timerRan).toBe(true);
  expect(subscriptions.size).toBe(0);
});

it('does not miss a reference event in the microtask gap after the dirty census',async()=>{
 vi.stubGlobal('window',globalThis);
 for(let depth=1;depth<=12;depth++){
  const image=file('Image Annotation/Media/'+'a'.repeat(64)+'.png'),note=file('race.md');
  const {application,emit}=changingApp([image,note]);let calls=0,referenced=false,deletedWhileReferenced=false;
  application.fileManager.trashFile.mockImplementation(async()=>{deletedWhileReferenced=referenced;});
  const provider=()=>{if(++calls===2){let chain=Promise.resolve();for(let i=0;i<depth;i++)chain=chain.then(()=>{});void chain.then(()=>{referenced=true;Object.assign(note,{text:`![[${image.path}]]`});emit('modify',note);});}return [];};
  await trashUnusedMedia(application as never,provider);
  expect(deletedWhileReferenced,`microtask depth ${depth}`).toBe(false);
 }
});

it('protects percent-encoded reference-style Markdown image destinations',async()=>{
 const image=file('Image Annotation/Media/'+'a'.repeat(64)+'.png');
 const note=file('reference.md',`![Photo][snapshot]\n[snapshot]: <Image%20Annotation/Media/${'%61'.repeat(64)}.png>`);
 expect((await scanMediaCleanup(app([image,note]),[])).candidates).toEqual([]);
});

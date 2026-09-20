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

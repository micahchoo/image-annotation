import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ MarkdownView: class MarkdownView {} }));
import { MarkdownView } from 'obsidian';
import { minimalEdit, noteText, transformNote } from '../src/note-writer';

/** An editor over one string, with the three calls the writer makes and offsets as Obsidian counts them. */
function fakeEditor(initial: string) {
  let text = initial;
  const ranges: Array<{ insert: string; from: number; to: number }> = [];
  const offsetToPos = (offset: number) => ({ offset });
  const editor = {
    getValue: () => text,
    offsetToPos,
    replaceRange: (insert: string, from: { offset: number }, to: { offset: number }) => {
      ranges.push({ insert, from: from.offset, to: to.offset });
      text = text.slice(0, from.offset) + insert + text.slice(to.offset);
    },
  };
  return { editor, ranges, text: () => text };
}

function app(open: { path: string; editor: unknown } | null, files: Record<string, string>) {
  const processed: string[] = [];
  const view = open ? Object.assign(new (MarkdownView as unknown as new () => MarkdownView)(), { file: { path: open.path }, editor: open.editor }) : null;
  return {
    processed,
    app: {
      workspace: { getLeavesOfType: () => (view ? [{ view }] : []) },
      vault: {
        read: async (file: { path: string }) => files[file.path],
        process: async (file: { path: string }, fn: (text: string) => string) => { files[file.path] = fn(files[file.path]); processed.push(file.path); },
      },
    } as never,
    files,
  };
}

describe('the smallest edit', () => {
  it('leaves the common prefix and suffix alone', () => {
    expect(minimalEdit('one two three', 'one 2 three')).toEqual({ start: 4, end: 7, insert: '2' });
  });
  it('is an insertion when nothing is removed, and null when nothing changes', () => {
    expect(minimalEdit('ab', 'aXb')).toEqual({ start: 1, end: 1, insert: 'X' });
    expect(minimalEdit('same', 'same')).toBeNull();
  });
});

describe('writing into a note', () => {
  it('goes through the open editor with one minimal replaceRange, keeping the text after the edit', async () => {
    const { editor, ranges, text } = fakeEditor('Intro\n\nMiddle\n\nOutro ^tail');
    const { app: a, processed } = app({ path: 'n.md', editor }, {});
    await transformNote(a, { path: 'n.md' } as never, (t) => t.replace('Middle', 'Middle\n\nInserted'));
    expect(text()).toBe('Intro\n\nMiddle\n\nInserted\n\nOutro ^tail');
    // The longest common prefix wins, so the insertion lands before "Outro", not after "Middle".
    expect(ranges).toEqual([{ insert: 'Inserted\n\n', from: 15, to: 15 }]);
    expect(processed).toEqual([]);
  });
  it('does not touch the editor when the transform changes nothing', async () => {
    const { editor, ranges } = fakeEditor('Same');
    await transformNote(app({ path: 'n.md', editor }, {}).app, { path: 'n.md' } as never, (t) => t);
    expect(ranges).toEqual([]);
  });
  it('keeps CRLF line endings through the editor', async () => {
    const { editor, text } = fakeEditor('A\r\n\r\nB\r\n');
    await transformNote(app({ path: 'n.md', editor }, {}).app, { path: 'n.md' } as never, (t) => t.replace('B', 'B\r\nC'));
    expect(text()).toBe('A\r\n\r\nB\r\nC\r\n');
  });
  it('goes through the vault when the note is not open, and reads the file then', async () => {
    const { app: a, processed, files } = app(null, { 'n.md': 'Closed' });
    expect(await noteText(a, { path: 'n.md' } as never)).toBe('Closed');
    await transformNote(a, { path: 'n.md' } as never, (t) => `${t}!`);
    expect(files['n.md']).toBe('Closed!');
    expect(processed).toEqual(['n.md']);
  });
  it('reads the editor, not the file, when the note is open with unsaved text', async () => {
    const { editor } = fakeEditor('Unsaved');
    expect(await noteText(app({ path: 'n.md', editor }, { 'n.md': 'On disk' }).app, { path: 'n.md' } as never)).toBe('Unsaved');
  });
});

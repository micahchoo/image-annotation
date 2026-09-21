import { MarkdownView, type App, type TFile } from 'obsidian';

/**
 * One way to write into a note, however it is open.
 *
 * A note the owner has open is edited through its editor, so their cursor,
 * their undo history and their unsaved keystrokes survive; a note that is not
 * open goes through `vault.process`, Obsidian's atomic read-modify-write. The
 * editor edit is the smallest range that turns the old text into the new: the
 * common prefix and the common suffix are left alone.
 *
 * Until 2026-09-21 this was written twice in main.ts, and the second copy
 * trimmed only the prefix — so inserting a reference replaced everything from
 * the insertion point to the end of the note, cursor included.
 */

/** The open editor showing this note, if any. */
export function openEditor(app: App, file: TFile): MarkdownView['editor'] | undefined {
  return app.workspace.getLeavesOfType('markdown').map((leaf) => leaf.view).find((view): view is MarkdownView => view instanceof MarkdownView && view.file?.path === file.path)?.editor;
}

/** What the note says right now: the editor's text when it is open, else the file's. */
export async function noteText(app: App, file: TFile): Promise<string> {
  return openEditor(app, file)?.getValue() ?? await app.vault.read(file);
}

/** The smallest range of `text` whose replacement yields `next`. */
export function minimalEdit(text: string, next: string): { start: number; end: number; insert: string } | null {
  if (text === next) return null;
  let start = 0;
  while (start < text.length && start < next.length && text[start] === next[start]) start++;
  let end = text.length, nextEnd = next.length;
  while (end > start && nextEnd > start && text[end - 1] === next[nextEnd - 1]) { end--; nextEnd--; }
  return { start, end, insert: next.slice(start, nextEnd) };
}

/** Apply `transform` to the note's text: through its editor when open, else atomically through the vault. */
export async function transformNote(app: App, file: TFile, transform: (text: string) => string): Promise<void> {
  const editor = openEditor(app, file);
  if (!editor) { await app.vault.process(file, transform); return; }
  const text = editor.getValue();
  const edit = minimalEdit(text, transform(text));
  if (edit) editor.replaceRange(edit.insert, editor.offsetToPos(edit.start), editor.offsetToPos(edit.end));
}

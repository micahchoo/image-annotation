import type { ReferenceSpec } from './types';

/**
 * The one shape of a reference in a note: a fenced block in this language,
 * four lines long — the fence, the connection id, the mode, the closing fence.
 * Every reader and writer of that block asks this module, so the shape is
 * declared once. Until 2026-09-21 writing.ts re-derived it twice and main.ts
 * a third time.
 */
export const LANGUAGE = 'image-annotation';
export const FENCE = `\`\`\`${LANGUAGE}`;
export const CLOSING_FENCE = '```';
/** Lines a reference block spans, closing fence included. */
export const REFERENCE_LINES = 4;
export const MODES = ['inline', 'compact'] as const;

/** Is a whole reference block at `start` of `lines` — for `connectionId` when given, for any when not? */
export function isReferenceAt(lines: readonly string[], start: number, connectionId?: string): boolean {
  return lines[start] === FENCE
    && typeof lines[start + 1] === 'string' && lines[start + 1] !== '' && (connectionId === undefined || lines[start + 1] === connectionId)
    && (MODES as readonly string[]).includes(lines[start + 2] ?? '')
    && lines[start + 3] === CLOSING_FENCE;
}

/** Parse the two-line body of a image-annotation code block (or a complete block). */
export function parseReference(source: string): ReferenceSpec {
  if (typeof source !== 'string') throw new Error('A region reference must be text.');

  const text = source.replace(/\r\n?/g, '\n');
  let body = text;
  if (text.startsWith(FENCE)) {
    const lines = text.split('\n');
    if (lines.length !== REFERENCE_LINES || lines[0] !== FENCE || lines[REFERENCE_LINES - 1] !== CLOSING_FENCE) {
      throw new Error('A region reference code block must contain an id and a mode.');
    }
    body = `${lines[1]}\n${lines[2]}`;
  }

  const lines = body.split('\n');
  if (lines.length !== 2 || lines.some((line) => line.length === 0 || line.trim() !== line)) {
    throw new Error('A region reference must contain exactly two simple lines.');
  }
  const [connectionId, mode] = lines;
  if (!connectionId || /\s/.test(connectionId) || connectionId.includes('`')) {
    throw new Error('A region reference must have a non-empty connection id without spaces.');
  }
  if (!(MODES as readonly string[]).includes(mode)) {
    throw new Error("A region reference mode must be 'inline' or 'compact'.");
  }
  return { connectionId, mode: mode as ReferenceSpec['mode'] };
}

export function referenceMarkdown(connectionId: string, mode: 'inline' | 'compact'): string {
  if (!connectionId || /[\r\n]/.test(connectionId) || /\s/.test(connectionId) || connectionId.includes('`')) {
    throw new Error('A region reference must have a non-empty connection id without spaces.');
  }
  return `${FENCE}\n${connectionId}\n${mode}\n${CLOSING_FENCE}`;
}

export interface ReferenceSection {
  lineStart: number;
  lineEnd: number;
}

export interface ReferenceLocation {
  /** Zero-based inclusive line number of the opening fence. */
  start: number;
  /** Zero-based inclusive line number of the closing fence. */
  end: number;
}

export interface ReferenceOccurrence extends ReferenceLocation {
  connectionId: string;
  mode: 'inline' | 'compact';
}

function isReference(lines: string[], start: number, connectionId: string): boolean {
  return lines[start] === '```image-annotation'
    && lines[start + 1] === connectionId
    && (lines[start + 2] === 'inline' || lines[start + 2] === 'compact')
    && lines[start + 3] === '```';
}

type Fence = { character: '`' | '~'; length: number };

function openingFence(line: string): Fence | undefined {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
  return match ? { character: match[2][0] as '`' | '~', length: match[2].length } : undefined;
}

function closesFence(line: string, fence: Fence): boolean {
  const match = /^( {0,3})(`{3,}|~{3,})(\s*)$/.exec(line);
  return !!match && match[2][0] === fence.character && match[2].length >= fence.length;
}

function scanReferences(text: string): ReferenceOccurrence[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const matches: ReferenceOccurrence[] = [];
  let fence: Fence | undefined;
  for (let line = 0; line < lines.length; line++) {
    if (fence) {
      if (closesFence(lines[line], fence)) fence = undefined;
      continue;
    }
    const opening = openingFence(lines[line]);
    if (!opening) continue;
    if (opening.character === '`' && opening.length === 3 && lines[line] === '```image-annotation') {
      if (isReference(lines, line, lines[line + 1] ?? '')) {
        const mode = lines[line + 2] as 'inline' | 'compact';
        matches.push({ start: line, end: line + 3, connectionId: lines[line + 1], mode });
        line += 3;
        continue;
      }
    }
    // Suppress malformed image blocks and all nested-looking fences in any
    // other code block. Markdown does not nest fenced code blocks.
    fence = opening;
  }
  return matches;
}

/** List every real top-level image-annotation reference in a note. */
export function listReferences(text: string): ReferenceOccurrence[] {
  return scanReferences(text);
}

/** List exact occurrences for one connection, including each stored mode. */
export function listReferenceOccurrences(text: string, connectionId: string): ReferenceOccurrence[] {
  if (!connectionId || /[\r\n]/.test(connectionId)) throw new Error('A connection id is required.');
  return scanReferences(text).filter(reference => reference.connectionId === connectionId);
}

/** Remove only top-level image-annotation fences for the supplied IDs. */
export function removeReferences(text: string, connectionIds: Iterable<string>): string {
  const ids = new Set(connectionIds);
  if (!ids.size) return text;
  const lines = text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? [];
  const remove = new Set<number>();
  for (const reference of scanReferences(text)) {
    if (!ids.has(reference.connectionId)) continue;
    for (let line = reference.start; line <= reference.end; line++) remove.add(line);
  }
  return lines.filter((_, line) => !remove.has(line)).join('');
}

/**
 * Locate a reference by line range. A processor section is authoritative:
 * stale section metadata never falls back to another occurrence in the file.
 */
export function locateReference(text: string, connectionId: string, section?: ReferenceSection | null): ReferenceLocation {
  if (!connectionId || /[\r\n]/.test(connectionId)) throw new Error('A connection id is required.');
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  if (section) {
    const { lineStart, lineEnd } = section;
    if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd) || lineStart < 0 || lineEnd !== lineStart + 3 || lineEnd >= lines.length) {
      throw new Error('The reference moved. Reopen the note before changing its display.');
    }
    if (!isReference(lines, lineStart, connectionId)) {
      throw new Error('The reference moved. Reopen the note before changing its display.');
    }
    return { start: lineStart, end: lineEnd };
  }

  const matches = listReferenceOccurrences(text, connectionId);
  if (matches.length !== 1) {
    throw new Error(matches.length === 0
      ? 'The reference could not be found. Open the note in Reading view and retry.'
      : 'The reference appears more than once. Open the note in Reading view and retry.');
  }
  return { start: matches[0].start, end: matches[0].end };
}

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

function isReference(lines: string[], start: number, connectionId: string): boolean {
  return lines[start] === '```image-annotation'
    && lines[start + 1] === connectionId
    && (lines[start + 2] === 'inline' || lines[start + 2] === 'compact')
    && lines[start + 3] === '```';
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

  const matches: ReferenceLocation[] = [];
  for (let line = 0; line <= lines.length - 4; line++) {
    if (isReference(lines, line, connectionId)) matches.push({ start: line, end: line + 3 });
  }
  if (matches.length !== 1) {
    throw new Error(matches.length === 0
      ? 'The reference could not be found. Open the note in Reading view and retry.'
      : 'The reference appears more than once. Open the note in Reading view and retry.');
  }
  return matches[0];
}

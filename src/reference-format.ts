import type { ReferenceSpec } from './types';

const FENCE = '```image-annotation';

/** Parse the two-line body of a image-annotation code block (or a complete block). */
export function parseReference(source: string): ReferenceSpec {
  if (typeof source !== 'string') throw new Error('A region reference must be text.');

  const text = source.replace(/\r\n?/g, '\n');
  let body = text;
  if (text.startsWith(FENCE)) {
    const lines = text.split('\n');
    if (lines.length !== 4 || lines[0] !== FENCE || lines[3] !== '```') {
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
  if (mode !== 'inline' && mode !== 'compact') {
    throw new Error("A region reference mode must be 'inline' or 'compact'.");
  }
  return { connectionId, mode };
}

export function referenceMarkdown(connectionId: string, mode: 'inline' | 'compact'): string {
  if (!connectionId || /[\r\n]/.test(connectionId) || /\s/.test(connectionId) || connectionId.includes('`')) {
    throw new Error('A region reference must have a non-empty connection id without spaces.');
  }
  return `${FENCE}\n${connectionId}\n${mode}\n\`\`\``;
}

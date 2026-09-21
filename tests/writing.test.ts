import { describe, expect, it } from 'vitest';
import { blockIdOf, insertAfterBlock, listReferenceOccurrences, listReferences, locateReference, removeReferences, replaceReferenceMode } from '../src/writing';

const block = (id = 'connection-1', mode = 'inline') => `\`\`\`image-annotation\n${id}\n${mode}\n\`\`\``;

describe('locateReference', () => {
  it('locates the unique matching block without section metadata', () => {
    expect(locateReference(`# Note\n\n${block()}\n`, 'connection-1')).toEqual({ start: 2, end: 5 });
  });

  it('rejects duplicate occurrences when section metadata is unavailable', () => {
    expect(() => locateReference(`${block()}\n\nText\n\n${block()}`, 'connection-1')).toThrow(/more than once/);
  });

  it('uses the precise section occurrence and accepts CRLF text', () => {
    const text = `${block('other', 'compact')}\r\n\r\n${block()}\r\n`;
    expect(locateReference(text, 'connection-1', { lineStart: 5, lineEnd: 8 })).toEqual({ start: 5, end: 8 });
  });

  it('rejects stale section metadata without falling back to another match', () => {
    const text = `${block('connection-1')}\n\n${block('connection-1')}`;
    expect(() => locateReference(text, 'connection-1', { lineStart: 1, lineEnd: 4 })).toThrow(/moved/);
  });

  it('requires a valid mode and closing fence', () => {
    expect(() => locateReference('```image-annotation\nconnection-1\nwide\n```', 'connection-1')).toThrow(/could not be found/);
    expect(() => locateReference('```image-annotation\nconnection-1\ninline\ntext', 'connection-1')).toThrow(/could not be found/);
  });
});

describe('reference scanning and cleanup', () => {
  it('lists every top-level reference with its mode and connection id', () => {
    const text = `Before\n\n${block('connection-1', 'compact')}\nCaption: [[caption]]\n\n${block('connection-2')}`;
    expect(listReferences(text)).toEqual([
      { start: 2, end: 5, connectionId: 'connection-1', mode: 'compact' },
      { start: 8, end: 11, connectionId: 'connection-2', mode: 'inline' },
    ]);
    expect(listReferenceOccurrences(text, 'connection-1')).toEqual([
      { start: 2, end: 5, connectionId: 'connection-1', mode: 'compact' },
    ]);
  });

  it('does not treat image-like text inside a larger fenced block as a reference', () => {
    const text = `Before\n\n\`\`\`\`markdown\n${block('nested')}\n\`\`\`\`\n\n${block('real')}`;
    expect(listReferences(text)).toEqual([{ start: 9, end: 12, connectionId: 'real', mode: 'inline' }]);
  });

  it('removes matching fences while preserving prose and caption links', () => {
    const text = `Intro\r\n\r\n${block('remove-me').replaceAll('\n', '\r\n')}\r\nCaption: [[Image Annotation/Captions/remove-me]]\r\n\r\n${block('keep-me').replaceAll('\n', '\r\n')}\r\nAfter`;
    expect(removeReferences(text, new Set(['remove-me']))).toBe(`Intro\r\n\r\nCaption: [[Image Annotation/Captions/remove-me]]\r\n\r\n${block('keep-me').replaceAll('\n', '\r\n')}\r\nAfter`);
  });

  it('does not remove matching ids from nested code content', () => {
    const text = `Text\n\`\`\`\`\n${block('remove-me')}\n\`\`\`\`\n\n${block('remove-me')}`;
    const cleaned = removeReferences(text, ['remove-me']);
    expect(cleaned).toContain(block('remove-me'));
    expect(listReferences(cleaned)).toEqual([]);
  });
});


it('preserves mixed line endings in text outside removed references', () => {
 const text = `Before\r\n${block()}\nAfter\r\n`;
 expect(removeReferences(text, ['connection-1'])).toBe('Before\r\nAfter\r\n');
});

describe('the edits a note takes', () => {
  it('reads a block id at the end of a line, or on a line of its own, and nothing else', () => {
    expect(blockIdOf('Prose. ^abc-1')).toBe('abc-1');
    expect(blockIdOf('^lone')).toBe('lone');
    expect(blockIdOf('Prose. ^abc-1\r')).toBe('abc-1');
    expect(blockIdOf('no^id here')).toBeUndefined();
    expect(blockIdOf('math a^2')).toBeUndefined();
  });
  it('inserts after the paragraph that carries the id, and at the end when there is none', () => {
    const text = 'One ^p1\n\nTwo ^p2\n';
    expect(insertAfterBlock(text, 'p1', '\n\nREF\n')).toBe('One ^p1\n\n\nREF\n\n\nTwo ^p2\n');
    expect(insertAfterBlock(text, undefined, '\n\nREF\n')).toBe(`${text}\n\nREF\n`);
    expect(() => insertAfterBlock(text, 'gone', 'x')).toThrow(/moved or was removed/);
  });
  it('swaps a reference mode in place and keeps CRLF', () => {
    const text = `Intro\r\n\r\n${block('c-1', 'inline').replaceAll('\n', '\r\n')}\r\nAfter`;
    expect(replaceReferenceMode(text, 'c-1', 'compact')).toBe(`Intro\r\n\r\n${block('c-1', 'compact').replaceAll('\n', '\r\n')}\r\nAfter`);
  });
});

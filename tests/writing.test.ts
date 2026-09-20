import { describe, expect, it } from 'vitest';
import { locateReference } from '../src/writing';

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

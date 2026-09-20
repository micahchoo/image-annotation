import { describe, expect, it } from 'vitest';
import { parseReference, referenceMarkdown } from '../src/reference-format';

describe('region references', () => {
  it('parses a simple two-line body', () => {
    expect(parseReference('connection-1\ninline')).toEqual({ connectionId: 'connection-1', mode: 'inline' });
    expect(parseReference('connection-1\ncompact')).toEqual({ connectionId: 'connection-1', mode: 'compact' });
  });

  it('round trips the complete Markdown code block', () => {
    const markdown = referenceMarkdown('connection-1', 'compact');
    expect(parseReference(markdown)).toEqual({ connectionId: 'connection-1', mode: 'compact' });
  });

  it.each(['', 'connection-1', 'connection-1\n', 'connection-1\ninline\nextra', 'connection-1\nwide', 'connection 1\ninline', '```image-annotation\nconnection-1\ninline\n```\n'])('rejects invalid source %j', (source) => {
    expect(() => parseReference(source)).toThrow();
  });

  it('rejects unsafe ids when generating Markdown', () => {
    expect(() => referenceMarkdown('connection 1', 'inline')).toThrow();
    expect(() => referenceMarkdown('connection-1\nother', 'inline')).toThrow();
  });
});

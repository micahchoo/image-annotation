import { describe, expect, it } from 'vitest';
import { FENCE, LANGUAGE, REFERENCE_LINES, isReferenceAt, parseReference, referenceMarkdown } from '../src/reference-format';

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

describe('the one shape of a reference', () => {
  it('is what the renderer writes, what the scanner finds, and what the processor is registered for', () => {
    const lines = referenceMarkdown('connection-1', 'inline').split('\n');
    expect(lines).toHaveLength(REFERENCE_LINES);
    expect(lines[0]).toBe(FENCE);
    expect(FENCE.endsWith(LANGUAGE)).toBe(true);
    expect(isReferenceAt(lines, 0)).toBe(true);
    expect(isReferenceAt(lines, 0, 'connection-1')).toBe(true);
    expect(isReferenceAt(lines, 0, 'other')).toBe(false);
    expect(isReferenceAt(['```image-annotation', 'connection-1', 'wide', '```'], 0)).toBe(false);
    expect(isReferenceAt(['```image-annotation', '', 'inline', '```'], 0)).toBe(false);
  });
});

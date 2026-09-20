import { describe, expect, it } from 'vitest';
import { anchorPassage } from '../src/passage';

class FakeEditor {
  lines: string[];
  constructor(lines: string[], private from: { line: number; ch: number }, private to = from) { this.lines = [...lines]; }
  getCursor(which: 'from' | 'to') { return which === 'from' ? this.from : this.to; }
  getLine(line: number) { return this.lines[line]; }
  lastLine() { return this.lines.length - 1; }
  replaceRange(value: string, position: { line: number; ch: number }) { this.lines[position.line] = this.lines[position.line].slice(0, position.ch) + value + this.lines[position.line].slice(position.ch); }
}

describe('anchorPassage', () => {
  it('anchors the complete surrounding paragraph and preserves an existing id', () => {
    const editor = new FakeEditor(['Before', '', 'First line', 'Second line', '', 'After'], { line: 3, ch: 3 });
    expect(anchorPassage(editor as never)).toBe(editor.lines[3].match(/\^([\w-]+)$/)?.[1]);
    expect(editor.lines[3]).toMatch(/Second line \^ia-/);
    const existing = new FakeEditor(['A paragraph ^native-id'], { line: 0, ch: 4 });
    expect(anchorPassage(existing as never)).toBe('native-id');
    expect(existing.lines[0]).toBe('A paragraph ^native-id');
  });

  it('rejects selections that span separate paragraphs or block syntax', () => {
    expect(() => anchorPassage(new FakeEditor(['One', '', 'Two'], { line: 0, ch: 0 }, { line: 2, ch: 1 }) as never)).toThrow(/one paragraph/);
    expect(() => anchorPassage(new FakeEditor(['```ts', 'const x = 1;', '```'], { line: 1, ch: 2 }) as never)).toThrow(/prose paragraph/);
    expect(() => anchorPassage(new FakeEditor(['- list item'], { line: 0, ch: 2 }) as never)).toThrow(/prose paragraph/);
  });
});

it('keeps standalone native IDs and rejects paragraphs inside fenced code',()=>{
 const standalone=new FakeEditor(['Paragraph','^native-id'],{line:0,ch:2});
 expect(anchorPassage(standalone as never)).toBe('native-id');
 const fenced=new FakeEditor(['```text','','Paragraph inside code','','```'],{line:2,ch:1});
 expect(()=>anchorPassage(fenced as never)).toThrow(/outside a code block/);
});

it.each([
 {lines:['    const important = 1;']}, {lines:['\tconst important = 1;']}, {lines:['1) Ordered item']},
 {lines:['- item', '', '  continuation']}, {lines:['1. item', '', '   continuation']},
 {lines:['Heading', '===']}, {lines:['Heading', '---']}, {lines:['a | b', '--- | ---']},
 {lines:['---']}, {lines:['<div>', 'text', '</div>']}, {lines:['[label]: https://example.test']},
 {lines:['# Heading']}, {lines:['> Quote']}, {lines:['~~~', 'code', '~~~']},
])('refuses non-prose without changing text: $lines', ({lines}) => {
 const selected = lines.findIndex(line => line.includes('continuation'));
 const editor = new FakeEditor(lines, {line:selected < 0 ? 0 : selected,ch:0});
 const before = [...editor.lines];
 expect(() => anchorPassage(editor as never)).toThrow(/prose paragraph/);
 expect(editor.lines).toEqual(before);
});

it('accepts prose following a completed list and preserves separated native anchors', () => {
 const editor = new FakeEditor(['- item', '', 'New prose'], {line:2,ch:1});
 expect(anchorPassage(editor as never)).toMatch(/^ia-/);
 const anchored = new FakeEditor(['Prose', '', '^existing'], {line:0,ch:1});
 expect(anchorPassage(anchored as never)).toBe('existing');
});

it.each([
 {lines:['---','key: value','','field: value','---'],line:3},
 {lines:['<div>','','body','','</div>'],line:2},
 {lines:['<!--','','comment body','','-->'],line:2},
 {lines:['$$','','equation','','$$'],line:2},
])('refuses document-level non-prose context across blank lines: $lines',({lines,line})=>{
 const editor=new FakeEditor(lines,{line,ch:1});const before=[...editor.lines];
 expect(()=>anchorPassage(editor as never)).toThrow(/prose paragraph/);expect(editor.lines).toEqual(before);
});

it('accepts prose after frontmatter and closed HTML',()=>{
 const editor=new FakeEditor(['---','key: value','---','','<div>','body','</div>','','Prose'],{line:8,ch:1});
 expect(anchorPassage(editor as never)).toMatch(/^ia-/);
});

it('ignores HTML examples in a completed fenced code block',()=>{
 const editor=new FakeEditor(['```html','<div>','```','','Prose'],{line:4,ch:1});
 expect(anchorPassage(editor as never)).toMatch(/^ia-/);
});

it('accepts prose after a complete same-line display-math block',()=>{
 const editor=new FakeEditor(['$$x + y$$','','Prose'],{line:2,ch:1});
 expect(anchorPassage(editor as never)).toMatch(/^ia-/);
});

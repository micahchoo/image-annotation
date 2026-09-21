import type { Editor } from 'obsidian';
import { blockIdOf } from './writing';
/** Anchor a single paragraph, preserving an existing native Obsidian block ID. */
export function anchorPassage(editor:Editor):string {
 const from=editor.getCursor('from'),to=editor.getCursor('to');
 let start=from.line,end=to.line;
 if(to.ch===0&&end>start)end--;
 while(start>0&&editor.getLine(start-1).trim())start--;
 while(end<editor.lastLine()&&editor.getLine(end+1).trim())end++;
 const lines=Array.from({length:end-start+1},(_,i)=>editor.getLine(start+i));
 if(lines.some(l=>!l.trim())||!lines.join('').trim())throw new Error('Select a passage within one paragraph.');
 if(lines.some(l=>/^(?: {4}| *\t)|^\s*(?:`{3,}|~{3,}|[-*+]\s|\d+[.)]\s|>|\||#|<|\[[^\]]+\]:|(?:[-*_]\s*){3,}$|[=-]+\s*$|:?-{3,}.*\|)/.test(l))||isListContinuation(editor,start)||inExcludedContext(editor,start))throw new Error('Choose a prose paragraph, or attach to the whole note instead.');
 let fence:string|undefined;
 for(let line=0;line<=start;line++) {
  const match=editor.getLine(line).match(/^\s*(`{3,}|~{3,})/);
  if(match) {if(!fence)fence=match[1];else if(match[1][0]===fence[0]&&match[1].length>=fence.length)fence=undefined;}
 }
 if(fence)throw new Error('Choose a prose paragraph outside a code block.');
 const old=blockIdOf(lines.at(-1)!);
 if(old)return old;
 const separate=end+2<=editor.lastLine()?blockIdOf(editor.getLine(end+2)):undefined;
 if(separate&&/^\^/.test(editor.getLine(end+2)))return separate;
 const id=`ia-${crypto.randomUUID().slice(0,12)}`;
 editor.replaceRange(` ^${id}`,{line:end,ch:editor.getLine(end).length});
 return id;
}

/** A blank line does not end a list when the following paragraph is indented. */
function isListContinuation(editor: Editor, start: number): boolean {
 if (!/^ +/.test(editor.getLine(start))) return false;
 for (let line = start - 1; line >= 0; line--) {
  const text = editor.getLine(line);
  if (!text.trim()) continue;
  if (/^\s*(?:[-*+]|\d+[.)])\s/.test(text)) return true;
  if (/^\S/.test(text)) return false;
 }
 return false;
}

/** Blank lines inside metadata, HTML and display math do not make writable prose. */
function inExcludedContext(editor: Editor, start: number): boolean {
 let metadata = editor.getLine(0).trim() === '---';
 let comment = false, math = false;
 let fence: string | undefined;
 const html: string[] = [];
 for (let line = 0; line <= start; line++) {
  const text = editor.getLine(line).trim();
  if (metadata) {
   if (line > 0 && /^(?:---|\.\.\.)$/.test(text)) metadata = false;
   continue;
  }
  const delimiter = /^(`{3,}|~{3,})/.exec(text);
  if (fence) {
   if (delimiter && delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = undefined;
   continue;
  }
  if (delimiter && !comment && !math && !html.length) { fence = delimiter[1]; continue; }
  if (text.includes('<!--')) comment = true;
  if (text.includes('-->')) comment = false;
  if (comment) continue;
  if (/^\$\$/.test(text)) {
   if (math) math = false;
   else math = !/\$\$\s*$/.test(text.slice(2));
  }
  const closing = /^<\/([a-z][\w-]*)\s*>/i.exec(text);
  if (closing) {
   const index = html.lastIndexOf(closing[1].toLowerCase());
   if (index >= 0) html.splice(index);
  }
  const opening = /^<(address|article|aside|blockquote|details|div|dl|fieldset|figure|footer|form|h[1-6]|header|main|nav|ol|p|pre|script|section|style|table|ul)(?:\s|>)/i.exec(text);
  if (opening && !text.includes('/>') && !new RegExp(`</${opening[1]}\\s*>`, 'i').test(text)) html.push(opening[1].toLowerCase());
 }
 return metadata || comment || math || html.length > 0;
}

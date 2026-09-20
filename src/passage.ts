import type { Editor } from 'obsidian';
/** Anchor a single paragraph, preserving an existing native Obsidian block ID. */
export function anchorPassage(editor:Editor):string {
 const from=editor.getCursor('from'),to=editor.getCursor('to');
 let start=from.line,end=to.line;
 if(to.ch===0&&end>start)end--;
 while(start>0&&editor.getLine(start-1).trim())start--;
 while(end<editor.lastLine()&&editor.getLine(end+1).trim())end++;
 const lines=Array.from({length:end-start+1},(_,i)=>editor.getLine(start+i));
 if(lines.some(l=>!l.trim())||!lines.join('').trim())throw new Error('Select a passage within one paragraph.');
 if(lines.some(l=>/^\s*(```|~~~|[-*+] |\d+\. |>|\||#)/.test(l)))throw new Error('Choose a prose paragraph, or attach to the whole note instead.');
 let fence:string|undefined;
 for(let line=0;line<=start;line++) {
  const match=editor.getLine(line).match(/^\s*(`{3,}|~{3,})/);
  if(match) {if(!fence)fence=match[1];else if(match[1][0]===fence[0]&&match[1].length>=fence.length)fence=undefined;}
 }
 if(fence)throw new Error('Choose a prose paragraph outside a code block.');
 const old=lines.at(-1)!.match(/(?:^|\s)\^([a-zA-Z0-9-]+)\s*$/);
 if(old)return old[1];
 const separate=end+2<=editor.lastLine()?editor.getLine(end+2).match(/^\^([a-zA-Z0-9-]+)\s*$/):null;
 if(separate)return separate[1];
 const id=`ia-${crypto.randomUUID().slice(0,12)}`;
 editor.replaceRange(` ^${id}`,{line:end,ch:editor.getLine(end).length});
 return id;
}

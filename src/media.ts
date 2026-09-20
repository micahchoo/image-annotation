import { App, TFile, normalizePath, requestUrl } from 'obsidian';
import type { MediaSource } from './types';
export interface ImageCandidate { value: string; label: string; articlePath?: string; articleLine?: number }
export const isImage = (path: string): boolean => /\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(path.split(/[?#]/)[0]);
export function articleImages(text: string, articlePath: string): ImageCandidate[] {
 const result: ImageCandidate[]=[];
 const add=(value:string,label:string,offset:number)=> {
  if (!value || (!/^https?:\/\//i.test(value) && !isImage(value))) return;
  if (/^https?:\/\//i.test(value) && !isImage(value)) return;
  result.push({value,label:label || value.split('/').pop() || value,articlePath,articleLine:text.slice(0,offset).split('\n').length-1});
 };
 for (const m of text.matchAll(/!\[\[([^\]]+)\]\]/g)) { const [path,label]=m[1].split('|');add(path,label,m.index); }
 for (const m of text.matchAll(/!\[([^\]]*)\]\(\s*/g)) {
  let i=m.index+m[0].length;const start=i;let depth=0;
  if(text[i]==='<') {const end=text.indexOf('>',i);if(end>=0)add(text.slice(i+1,end),m[1],m.index);continue;}
  for(;i<text.length;i++) {
   if(text[i]==='\\'&&i+1<text.length){i++;continue;}
   if(text[i]==='(')depth++;
   else if(text[i]===')'){if(depth===0)break;depth--;}
   else if(/\s/.test(text[i])&&depth===0)break;
  }
  if(depth===0)add(text.slice(start,i).replace(/\\([()])/g,'$1'),m[1],m.index);
 }
 for(const m of text.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi))add(m[1].replace(/&amp;/g,'&'),'Image',m.index);
 return result.sort((a,b)=>(a.articleLine??0)-(b.articleLine??0));
}
async function folder(app:App,path:string):Promise<void> {
 let current='';for(const part of path.split('/')) {current=current ? `${current}/${part}`:part;if(!app.vault.getAbstractFileByPath(current)) {try{await app.vault.createFolder(current);}catch(e){if(!app.vault.getAbstractFileByPath(current))throw e;}}}
}
async function dimensions(url:string):Promise<{width:number;height:number}> {
 return new Promise((resolve,reject)=>{ const img=new Image();const timer=window.setTimeout(()=>{img.src='';reject(new Error('Image took too long to load.'));},20000);img.onload=()=>{window.clearTimeout(timer);resolve({width:img.naturalWidth,height:img.naturalHeight});};img.onerror=()=>{window.clearTimeout(timer);reject(new Error('This image could not be opened.'));};img.src=url; });
}
export async function prepareImage(app:App,candidate:ImageCandidate):Promise<MediaSource> {
 let file:TFile;let originalUrl:string|undefined;
 if(/^https?:\/\//i.test(candidate.value)) {
  originalUrl=candidate.value;
  // A HEAD request is only an early rejection. Some servers omit or lie about
  // Content-Length, so the downloaded bytes remain the authoritative check.
  let declaredTooLarge = false;
  try {
   const head=await requestUrl({url:originalUrl,method:'HEAD',throw:false});
   const contentLength=head.headers['content-length']??head.headers['Content-Length'];
   const declaredSize=contentLength===undefined?NaN:Number(contentLength);
   declaredTooLarge=head.status>=200&&head.status<300&&Number.isFinite(declaredSize)&&declaredSize>40*1024*1024;
  } catch {
   // HEAD is best effort. Continue because many image hosts reject HEAD.
  }
  if(declaredTooLarge)throw new Error('This image exceeds the 40 MB snapshot limit.');
  const response=await requestUrl({url:originalUrl,throw:true});
  if(response.arrayBuffer.byteLength>40*1024*1024)throw new Error('This image exceeds the 40 MB snapshot limit.');
  const mime=(response.headers['content-type']??'').split(';')[0].trim();
  const extension=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/bmp':'bmp','image/avif':'avif'} as Record<string,string>)[mime];
  if(!extension)throw new Error('Remote snapshots support PNG, JPEG, WebP, GIF, BMP, and AVIF images.');
  // Include content bytes in the identity: changed remote files become new snapshots.
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',response.arrayBuffer))).map(b=>b.toString(16).padStart(2,'0')).join('');
  await folder(app,'Image Annotation/Media');
  const path=`Image Annotation/Media/${hash}.${extension}`;
  const existing=app.vault.getAbstractFileByPath(path);
  file=existing instanceof TFile?existing:await app.vault.createBinary(path,response.arrayBuffer);
 } else {
  const path=candidate.value.split(/[?#]/)[0];
  const resolved=app.metadataCache.getFirstLinkpathDest(path,candidate.articlePath??'')??app.vault.getAbstractFileByPath(normalizePath(path));
  if(!(resolved instanceof TFile))throw new Error('Image not found in this vault.');file=resolved;
 }
 const size=await dimensions(app.vault.getResourcePath(file));
 if(!size.width||!size.height)throw new Error('Image dimensions could not be read.');
 return {path:file.path,originalUrl,articlePath:candidate.articlePath,articleLine:candidate.articleLine,...size};
}

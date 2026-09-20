// Synthetic cleanup benchmark; no real vault is accessed.
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({stdin:{contents:`export * from '${root}/src/media-cleanup.ts';export {TFile} from 'obsidian';`,resolveDir:root},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'stub',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export class TFile{};export const normalizePath=p=>p;'}));}}]});
globalThis.window=globalThis;
const {TFile,scanMediaCleanup,trashUnusedMedia}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const file=(path,text='')=>Object.assign(new TFile(),{path,name:path.split('/').pop(),extension:path.split('.').pop(),stat:{size:text.length},text});
for(const notes of [100000])for(const snapshots of [10000])for(const fraction of [0.5]){
 const files=new Map();const images=Array.from({length:snapshots},(_,i)=>file('Image Annotation/Media/'+i.toString(16).padStart(64,'0')+'.png'));for(const f of images)files.set(f.path,f);
 for(let i=0;i<notes;i++){const f=file(`notes/${i}.md`,'unrelated text '.repeat(100)+(i<snapshots*fraction?` ![[${images[i].path}]]`:''));files.set(f.path,f);}
 let reads=0,bytes=0;const handlers=new Map();const app={vault:{getFiles:()=>[...files.values()],getAbstractFileByPath:p=>files.get(p),cachedRead:async f=>{reads++;bytes+=f.text.length;return f.text;},on:(name,fn)=>{handlers.set(name,fn);return name;},offref:name=>handlers.delete(name)},workspace:{getLeavesOfType:()=>[]},metadataCache:{getFirstLinkpathDest:p=>files.get(p)},fileManager:{trashFile:async f=>files.delete(f.path)}};
 let maxGap=0,last=performance.now();const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;},1);
 const usedPaths=Object.freeze(Array.from({length:100000},(_,i)=>'used/'+i+'.png'));const start=performance.now();const result=await trashUnusedMedia(app,()=>usedPaths);const elapsed=performance.now()-start;await new Promise(r=>setTimeout(r,1));clearInterval(timer);
 console.log(JSON.stringify({notes,snapshots,usedFraction:fraction,removed:result.length,reads,bytes,elapsedMs:Math.round(elapsed),maxTimerGapMs:Math.round(maxGap)}));
}

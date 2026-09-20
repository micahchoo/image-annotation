// Synthetic in-memory index benchmark. Run: node --max-old-space-size=4096 scripts/benchmark-store.mjs 250000
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const entry = fileURLToPath(new URL('../src/store.ts', import.meta.url));
const bundle = await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',write:false});
globalThis.window = globalThis;
const { RegionStore } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const count=Number(process.argv[2]??100000),source={path:'images/map.png',width:100,height:100},geometry={type:'rect',x:0,y:0,width:1,height:1};
let regions=Array.from({length:count},(_,i)=>({id:'r-'+i,title:'Region '+i,source:{...source,path:'images/'+i+'.png'},geometry,created:'2026-09-20'}));let connections=regions.map((r,i)=>({id:'c-'+i,regionId:r.id,notePath:'notes/'+i+'.md',captionPath:'Image Annotation/Captions/'+i+'.md',created:'2026-09-20'}));let raw=JSON.stringify({version:1,regions,connections});regions=connections=null;const index={path:'Image Annotation/index.json',extension:'json',stat:{}};const app={vault:{getAbstractFileByPath:p=>p===index.path?index:{path:p},read:async()=>raw,process:async(f,fn)=>{raw=fn(raw)}}};const store=new RegionStore(app);
const parseStart=performance.now();JSON.parse(raw);console.log(JSON.stringify({count,label:'JSON.parse alone',ms:Math.round(performance.now()-parseStart)}));
async function measure(label,action){let last=performance.now(),gap=0;const timer=setInterval(()=>{const now=performance.now();gap=Math.max(gap,now-last);last=now;},1);const start=performance.now();await action();const ms=performance.now()-start;await new Promise(r=>setTimeout(r,1));clearInterval(timer);console.log(JSON.stringify({count,label,ms:Math.round(ms),maxGap:Math.round(gap),bytes:raw.length,heapMB:Math.round(process.memoryUsage().heapUsed/1e6)}));}
await measure('cold',()=>store.load());store.takeChanges();await measure('warm single edit',()=>store.updateRegion('r-0',geometry,'Changed'));console.log('invalidations',store.takeChanges().size);await measure('unrelated rename',()=>store.rename('missing','elsewhere'));await measure('broad folder rename',()=>store.rename('images','archive'));console.log('invalidations',store.takeChanges().size);
if (globalThis.gc) {
  for (let round=0;round<3;round++) {
    if (round>0) {
      await store.updateRegion('r-0',geometry,`Retained-heap round ${round}`);
      await store.rename(round===1?'archive':'images',round===1?'images':'archive');
      store.takeChanges();
    }
    globalThis.gc();
    console.log(JSON.stringify({count,label:'post-GC retained heap',round,heapMB:Math.round(process.memoryUsage().heapUsed/1e6),rssMB:Math.round(process.memoryUsage().rss/1e6)}));
  }
}

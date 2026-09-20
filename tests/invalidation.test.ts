import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('obsidian',()=>({normalizePath:(path:string)=>path,
 TFile:class TFile{},Component:class Component{},Modal:class Modal{},MarkdownView:class MarkdownView{},MarkdownRenderChild:class MarkdownRenderChild{},Menu:class Menu{},Notice:class Notice{},FuzzySuggestModal:class FuzzySuggestModal{},MarkdownRenderer:{},
 Plugin:class Plugin{addCommand(){}addRibbonIcon(){}registerEvent(){}registerDomEvent(){}registerMarkdownCodeBlockProcessor(){}register(){}},
}));
import {TFile} from 'obsidian';
import ImageAnnotationPlugin from '../src/main';

const region={id:'r-1',title:'Region',source:{path:'image.png',width:100,height:100},geometry:{type:'rect',x:0,y:0,width:1,height:1},created:'today'};
const connection={id:'c-1',regionId:region.id,notePath:'note.md',captionPath:'Image Annotation/Captions/c.md',created:'today'};
function file(path:string,text=''){return Object.assign(new TFile(),{path,name:path.split('/').pop(),extension:path.split('.').pop(),stat:{size:text.length},text});}
async function fixture(indexInitially=true){
 const index=file('Image Annotation/index.json',JSON.stringify({version:1,regions:[region],connections:[connection]}));
 const caption=file(connection.captionPath,'body'),image=file(region.source.path);
 const files=new Map([caption,image,...(indexInitially?[index]:[])].map(f=>[f.path,f]));
 const handlers=new Set<{name:string;fn:(file:TFile,oldPath?:string)=>void}>();
 const app={vault:{getAbstractFileByPath:(path:string)=>files.get(path),read:async(f:TFile)=>(f as TFile&{text:string}).text,on:(name:string,fn:(file:TFile,oldPath?:string)=>void)=>{const ref={name,fn};handlers.add(ref);return ref;},offref:(ref:unknown)=>handlers.delete(ref as never),getFiles:()=>[...files.values()],cachedRead:async(f:TFile)=>(f as TFile&{text:string}).text,process:async(f:TFile,fn:(text:string)=>string)=>Object.assign(f,{text:fn((f as TFile&{text:string}).text)})},workspace:{on:()=>{},getLeavesOfType:()=>[]},metadataCache:{getFirstLinkpathDest:(path:string)=>files.get(path)},fileManager:{trashFile:vi.fn(async(f:TFile)=>{files.delete(f.path);})}};
 const plugin=new ImageAnnotationPlugin(app as never,{} as never);Object.assign(plugin,{app});await plugin.onload();
 const refresh=vi.fn();(plugin as unknown as {listeners:Map<()=>void,string>}).listeners.set(refresh,connection.id);
 async function emit(name:string,f:TFile){for(const ref of handlers)if(ref.name===name)ref.fn(f);await vi.advanceTimersByTimeAsync(200);}
 return {plugin,index,caption,image,files,refresh,emit,app,handlers};
}
beforeEach(()=>{vi.useFakeTimers({shouldAdvanceTime:true});vi.stubGlobal('window',globalThis);vi.stubGlobal('document',{});});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('restored dependency invalidation',()=>{
 it.each(['caption','image'] as const)('recovers a deleted %s without unrelated changes',async name=>{
  const f=await fixture();const dependency=f[name];f.files.delete(dependency.path);await f.emit('delete',dependency);expect(f.refresh).toHaveBeenCalledTimes(1);
  f.files.set(dependency.path,dependency);await f.emit('create',dependency);expect(f.refresh).toHaveBeenCalledTimes(2);
 });
 it('loads a late arriving index and ignores unchanged own-write echoes',async()=>{
  const f=await fixture(false);expect(f.plugin.getConnection(connection.id)).toBeUndefined();
  f.files.set(f.index.path,f.index);await f.emit('create',f.index);expect(f.plugin.getConnection(connection.id)?.id).toBe(connection.id);expect(f.refresh).toHaveBeenCalledTimes(1);
  await f.emit('modify',f.index);await f.emit('create',f.index);expect(f.refresh).toHaveBeenCalledTimes(1);
 });
 it('recovers a deleted index and ignores unrelated file creates',async()=>{
  const f=await fixture();f.files.delete(f.index.path);await f.emit('delete',f.index);expect(f.plugin.getConnection(connection.id)).toBeUndefined();
  f.files.set(f.index.path,f.index);await f.emit('create',f.index);expect(f.plugin.getConnection(connection.id)?.id).toBe(connection.id);expect(f.refresh).toHaveBeenCalledTimes(2);
  await f.emit('create',file('unrelated.md'));expect(f.refresh).toHaveBeenCalledTimes(2);
 });
});

it('cleanup reloads the region index only when changed, preserving new region use',async()=>{
 const f=await fixture();const a=file('Image Annotation/Media/'+'a'.repeat(64)+'.png'),b=file('Image Annotation/Media/'+'b'.repeat(64)+'.png');
 f.files.set(a.path,a);f.files.set(b.path,b);
 const initialSubscriptions=f.handlers.size;
 const load=vi.spyOn(f.plugin.store,'load');
 f.app.fileManager.trashFile.mockImplementation(async deleted=>{
  f.files.delete(deleted.path);
  f.index.text=JSON.stringify({version:1,regions:[{...region,source:{...region.source,path:b.path}}],connections:[connection]});
  for(const ref of f.handlers)if(ref.name==='modify')ref.fn(f.index);
 });
 const invoke=f.plugin as unknown as {trashReviewedMedia(paths:string[],options:object):Promise<{path:string}[]>};
 const result=await invoke.trashReviewedMedia([a.path,b.path],{});
 expect(result.map(item=>item.path)).toEqual([a.path]);expect(load).toHaveBeenCalledTimes(2);expect(f.handlers.size).toBe(initialSubscriptions);
});

it('cleanup does not reload an unchanged region index per candidate',async()=>{
 const f=await fixture();const images=Array.from({length:100},(_,i)=>file('Image Annotation/Media/'+i.toString(16).padStart(64,'0')+'.png'));
 for(const image of images)f.files.set(image.path,image);
 const load=vi.spyOn(f.plugin.store,'load');
 const invoke=f.plugin as unknown as {trashReviewedMedia(paths:string[],options:object):Promise<{path:string}[]>};
 const result=await invoke.trashReviewedMedia(images.map(image=>image.path),{});
 expect(result).toHaveLength(100);expect(load).toHaveBeenCalledTimes(1);
});

import { App, Component, FuzzySuggestModal, MarkdownRenderChild, MarkdownRenderer, MarkdownView, Menu, Modal, Notice, Plugin, TFile, type TAbstractFile } from 'obsidian';
import type { Connection, MediaSource, PassageTarget, PluginHost, Region, RegionEditorHandle } from './types';
import { RegionStore } from './store';
import { mountRegionEditor } from './region-editor';
import { parseReference, referenceMarkdown, renderReference } from './references';
import { articleImages, ImageCandidate, isImage, prepareImage } from './media';
import { anchorPassage } from './passage';
import { locateReference, listReferenceOccurrences, listReferences, removeReferences } from './writing';
import type { ReferenceSection } from './writing';
import { scanMediaCleanup, trashUnusedMedia, type MediaCleanupOptions } from './media-cleanup';

const message=(error:unknown)=>error instanceof Error?error.message:String(error);
type TargetFactory=()=>PassageTarget;
class Picker<T> extends FuzzySuggestModal<T> {
 constructor(app:App,private items:T[],private label:(item:T)=>string,private choose:(item:T)=>void,placeholder:string){super(app);this.setPlaceholder(placeholder);}
 getItems(){return this.items;}
 getItemText(item:T){return this.label(item);}
 onChooseItem(item:T){this.close();window.setTimeout(()=>this.choose(item),0);}
}

export default class ImageAnnotationPlugin extends Plugin implements PluginHost {
 store!:RegionStore;
 private listeners=new Map<()=>void,string>();
 private pendingPaths=new Set<string>();
 private modals=new Set<Modal>();
 private imageMenus=new WeakMap<Menu,ImageCandidate>();
 private refreshTimer:number|undefined;
 async onload(){
  this.store=new RegionStore(this.app);
  try{await this.store.load();this.store.takeChanges();}catch(e){new Notice(`Image Annotation: ${message(e)}`,10000);}
  this.addCommand({id:'annotate-image',name:'Annotate an image',callback:()=>this.chooseImage()});
  this.addCommand({id:'attach-evidence',name:'Attach an image region to this paragraph',editorCallback:(editor,view)=>{
   if(!view.file)return;
   const file=view.file,selection=editor.listSelections(),original=editor.getValue();
   let anchored:PassageTarget|undefined;
   const target:TargetFactory=()=>{
    if(anchored){if(!editor.getValue().includes(`^${anchored.blockId}`))throw new Error('The paragraph link was removed. Select the paragraph again.');return {...anchored,notePath:file.path};}
    if(view.file?.path!==file.path||editor.getValue()!==original)throw new Error('The paragraph changed. Select it again and retry.');
    editor.setSelections(selection);
    anchored={notePath:file.path,blockId:anchorPassage(editor)};return anchored;
   };
   this.chooseEvidence(target);
  }});
  this.addCommand({id:'browse-regions',name:'Browse image regions',callback:()=>this.chooseRegion()});
  this.addCommand({id:'clean-unused-snapshots',name:'Clean up unused image snapshots',callback:()=>this.run(()=>this.reviewUnusedMedia())});
  this.addCommand({id:'clean-unavailable-references',name:'Remove unavailable references',callback:()=>this.run(()=>this.reviewUnavailableReferences())});
  this.addRibbonIcon('scan','Annotate an image',()=>this.chooseImage());
  this.registerEvent(this.app.workspace.on('file-menu',(menu,file)=>{
   if(file instanceof TFile&&isImage(file.path))this.addImageMenuItem(menu,{value:file.path,label:file.basename});
  }));
  this.registerDomEvent(document,'contextmenu',(event:MouseEvent)=>{
   const element=event.target;
   if(!(element instanceof HTMLImageElement)||!element.closest('.markdown-preview-view, .markdown-source-view'))return;
   const article=this.app.workspace.getActiveFile();
   const raw=element.closest('.internal-embed')?.getAttribute('src')??element.getAttribute('src')??'';
   let value=raw;
   if(!/^https?:\/\//i.test(value)){
    const local=this.app.vault.getFiles().find(f=>isImage(f.path)&&this.app.vault.getResourcePath(f).split('?')[0]===element.src.split('?')[0]);
    if(local)value=local.path;
   }
   if(!value)return;
   // Obsidian's image handler uses the same event menu. Do not open a second menu.
   this.addImageMenuItem(Menu.forEvent(event),{value,label:element.alt||'Image',articlePath:article?.path});
  });
  this.registerMarkdownCodeBlockProcessor('image-annotation',async(source,el,ctx)=>{
   const child=new MarkdownRenderChild(el);ctx.addChild(child);
   let active=true;let generation=0;
   child.register(()=>{active=false;this.listeners.delete(refresh);});
   let rendered:Component|undefined;
   const refresh=()=>{
    const ticket=++generation;
    this.run(async()=>{
     if(!active)return;
     if(rendered)child.removeChild(rendered);
     rendered=new Component();child.addChild(rendered);
     const staging=createDiv();
     try{await renderReference(this,parseReference(source),staging,rendered);if(active&&ticket===generation)el.replaceChildren(...staging.childNodes);}catch(e){if(active&&ticket===generation){el.empty();el.createEl('p',{text:`Image Annotation: ${message(e)}`,cls:'ia-error'});}}
    });
   };
   this.listeners.set(refresh,parseReference(source).connectionId);refresh();
   child.registerDomEvent(el,'image-annotation-mode' as keyof HTMLElementEventMap,((event:CustomEvent<{mode?:unknown}>)=>{
    const mode=event.detail?.mode;if(mode!=='inline'&&mode!=='compact')return;
    const info=ctx.getSectionInfo(el);const file=this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if(!(file instanceof TFile))return;
    const spec=parseReference(source);
    this.run(async()=>{
     const original=await this.noteText(file);
     const apply=async(section?:ReferenceSection|null)=>{
      await this.transformNote(file,text=>{
       if(text!==original)throw new Error('The note changed. Choose the reference again.');
       const {start,end}=locateReference(text,spec.connectionId,section);
       const newline=text.includes('\r\n')?'\r\n':'\n';
       const lines=text.split(/\r?\n/);
       lines.splice(start,end-start+1,referenceMarkdown(spec.connectionId,mode).replace(/\n/g,newline));return lines.join(newline);
      });
      // The source processor reruns for the edited occurrence, which may be a
      // different duplicate from the one whose controls opened the picker.
     };
     const matches=listReferenceOccurrences(original,spec.connectionId);
     if(!info&&matches.length>1){
      const lines=original.split(/\r?\n/);
      new Picker(this.app,matches,item=>`Line ${item.start+1} · ${item.mode} · ${lines.slice(Math.max(0,item.start-2),item.start).join(' ').trim()||'Start of note'}`,item=>this.run(()=>apply({lineStart:item.start,lineEnd:item.end})),'Choose the reference to change').open();
     }else await apply(info);
    });
   }) as EventListener);
  });
  this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>this.run(async()=>{await this.store.rename(oldPath,file.path);this.changed();})));
  const queuePath=(file:TAbstractFile)=>{
   this.pendingPaths.add(file.path);
   window.clearTimeout(this.refreshTimer);this.refreshTimer=window.setTimeout(()=>this.run(async()=>{
    const paths=this.pendingPaths;this.pendingPaths=new Set();
    if(paths.has('Image Annotation/index.json'))await this.store.load();
    const ids=this.store.takeChanges();
    for(const path of paths)if(path!=='Image Annotation/index.json')for(const id of this.store.connectionsForPath(path))ids.add(id);
    this.changed(ids);
   }),150);
  };
  this.registerEvent(this.app.vault.on('modify',queuePath));
  this.registerEvent(this.app.vault.on('create',file=>{if(file instanceof TFile)queuePath(file);}));
  this.registerEvent(this.app.vault.on('delete',file=>this.run(async()=>{
   const ids=this.store.connectionsForPath(file.path);
   if(file.path==='Image Annotation/index.json'||file.path==='Image Annotation')await this.store.load();
   this.changed(new Set([...ids,...this.store.takeChanges()]));
  })));
  this.register(()=>window.clearTimeout(this.refreshTimer));
 }
 onunload(){for(const modal of this.modals)modal.close();this.modals.clear();this.listeners.clear();}
 private addImageMenuItem(menu:Menu,candidate:ImageCandidate){
  const previous=this.imageMenus.get(menu);
  if(!previous||candidate.articlePath)this.imageMenus.set(menu,candidate);
  if(previous)return;
  menu.addItem(item=>item.setTitle('Annotate image').setIcon('scan').onClick(()=>this.run(()=>this.openImage(this.imageMenus.get(menu)!))));
 }
 run(action:()=>Promise<unknown>){void action().catch(e=>new Notice(`Image Annotation: ${message(e)}`,8000));}
 changed(ids=this.store.takeChanges()){for(const [listener,id] of this.listeners)if(ids.has(id))listener();}
 track(modal:Modal){this.modals.add(modal);modal.open();}
 untrack(modal:Modal){this.modals.delete(modal);}
 getRegion(id:string){return this.store.getRegion(id);}
 getConnection(id:string){return this.store.getConnection(id);}
 getConnections(id:string){return this.store.getConnections(id);}
 resourceUrl(source:MediaSource){const file=this.app.vault.getAbstractFileByPath(source.path);return file instanceof TFile?this.app.vault.getResourcePath(file):'';}
 readCaption(connection:Connection){return this.store.readCaption(connection);}
 async openTarget(connection:Connection){await this.app.workspace.openLinkText(connection.notePath+(connection.blockId?`#^${connection.blockId}`:''),'',true);}
 async openArticle(region:Region){
  if(region.source.articlePath){await this.app.workspace.openLinkText(region.source.articlePath,'',true,{eState:{line:region.source.articleLine??0}});}
  else await this.app.workspace.openLinkText(region.source.path,'',true);
 }
 editCaption(connection:Connection){this.run(()=>this.app.workspace.openLinkText(connection.captionPath,'',true));}
 openRegion(id:string){const region=this.getRegion(id);if(!region){new Notice('This region could not be found.');return;}this.showEditor(region.source,undefined,id);}
 showEditor(source:MediaSource,target?:TargetFactory,selectedId?:string){
  if(!this.resourceUrl(source)){new Notice('The source image is missing. Restore it to its recorded vault path.');return;}
  this.track(new ImageModal(this,source,target,selectedId));
 }
 async openImage(candidate:ImageCandidate,target?:TargetFactory){
  new Notice(/^https?:/.test(candidate.value)?'Saving an image snapshot…':'Opening image…',2000);
  const source=await prepareImage(this.app,candidate);this.showEditor(source,target);
 }
 chooseImage(target?:TargetFactory){this.run(async()=>{
  const active=this.app.workspace.getActiveFile();let images:ImageCandidate[]=[];
  if(active?.extension==='md')images=articleImages(await this.app.vault.cachedRead(active),active.path);
  if(active&&isImage(active.path))images.unshift({value:active.path,label:active.basename});
  const local=this.app.vault.getFiles().filter(f=>isImage(f.path)&&!images.some(i=>i.value===f.path)).map(f=>({value:f.path,label:f.path}));
  images.push(...local);
  if(!images.length){new Notice('Open a note containing images, or add an image to your vault.');return;}
  new Picker(this.app,images,i=>`${i.articlePath?'This note · ':''}${i.label}`,i=>this.run(()=>this.openImage(i,target)),'Choose an image to annotate').open();
 });}
 chooseRegion(target?:TargetFactory){const regions=this.store.allRegions();if(!regions.length){this.chooseImage(target);return;}
  new Picker(this.app,regions,r=>`${r.title} · ${r.source.articlePath??r.source.path}`,r=>target?this.attach(r,target):this.openRegion(r.id),'Choose a region').open();
 }
 chooseEvidence(target:TargetFactory){
  const choices=[{label:'Select a new region from an image',action:()=>this.chooseImage(target)},{label:'Attach an existing region',action:()=>this.chooseRegion(target)}];
  new Picker(this.app,choices,c=>c.label,c=>c.action(),'Attach an image region').open();
 }
 attach(region:Region,target?:TargetFactory){this.track(new AttachModal(this,region,target));}
 private openNote(file:TFile):MarkdownView|undefined {
  return this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view).find((view):view is MarkdownView=>view instanceof MarkdownView&&view.file?.path===file.path);
 }
 private async noteText(file:TFile):Promise<string>{return this.openNote(file)?.editor.getValue()??await this.app.vault.read(file);}
 private async transformNote(file:TFile,transform:(text:string)=>string):Promise<void>{
  const view=this.openNote(file);
  if(!view){await this.app.vault.process(file,transform);return;}
  const editor=view.editor,text=editor.getValue(),next=transform(text);
  if(text===next)return;
  let start=0;while(start<text.length&&start<next.length&&text[start]===next[start])start++;
  let end=text.length,nextEnd=next.length;while(end>start&&nextEnd>start&&text[end-1]===next[nextEnd-1]){end--;nextEnd--;}
  editor.replaceRange(next.slice(start,nextEnd),editor.offsetToPos(start),editor.offsetToPos(end));
 }
 async removeNoteReferences(ids:Set<string>):Promise<void>{
  for(const file of this.app.vault.getMarkdownFiles()){
   if(!listReferences(await this.noteText(file)).some(reference=>ids.has(reference.connectionId)))continue;
   await this.transformNote(file,text=>removeReferences(text,ids));
  }
 }
 private async cleanupProgress<T>(action:(options:MediaCleanupOptions)=>Promise<T>):Promise<T>{
  const modal=new CleanupProgressModal(this);this.track(modal);
  try{return await action({signal:modal.controller.signal,onProgress:(done,total)=>modal.progress(done,total)});}
  finally{modal.close();}
 }
 private async trashReviewedMedia(paths:string[],options:MediaCleanupOptions){
  let revision=0,loaded=-1;
  const mark=(file:TAbstractFile,oldPath?:string)=>{if([file.path,oldPath].some(path=>path==='Image Annotation/index.json'||path==='Image Annotation'))revision++;};
  const events=[this.app.vault.on('create',mark),this.app.vault.on('modify',mark),this.app.vault.on('delete',mark),this.app.vault.on('rename',mark)];
  try{return await trashUnusedMedia(this.app,async()=>{
   while(loaded!==revision){options.signal?.throwIfAborted();const observed=revision;await this.store.load();this.changed();loaded=observed;}
   return this.store.imagePaths();
  },paths,options);}finally{for(const event of events)this.app.vault.offref(event);}
 }
 private async reviewUnusedMedia():Promise<void>{
  if([...this.modals].some(modal=>modal instanceof ImageModal)){new Notice('Close the image editor before cleaning up snapshots.');return;}
  await this.store.load();this.changed();
  const report=await this.cleanupProgress(options=>scanMediaCleanup(this.app,this.store.imagePaths(),options));
  if(!report.candidates.length){new Notice('No unused image snapshots found.');return;}
  this.track(new ReviewModal(this,'Clean up unused image snapshots',report.candidates.map(file=>`${file.path} (${Math.ceil(file.size/1024)} KB)`),'Move to trash',async()=>{
   if([...this.modals].some(modal=>modal instanceof ImageModal))throw new Error('Close the image editor before cleaning up snapshots.');
   const removed=await this.cleanupProgress(options=>this.trashReviewedMedia(report.candidates.map(file=>file.path),options));
   new Notice(`${removed.length} unused image snapshots moved to trash. Images now in use were kept.`);
  }));
 }
 private async reviewUnavailableReferences():Promise<void>{
  await this.store.load();this.changed();
  const files:TFile[]=[];
  for(const file of this.app.vault.getMarkdownFiles())if(listReferences(await this.noteText(file)).some(reference=>!this.getConnection(reference.connectionId)))files.push(file);
  if(!files.length){new Notice('No unavailable references found.');return;}
  this.track(new ReviewModal(this,'Remove unavailable references',files.map(file=>file.path),'Remove references',async()=>{
   await this.store.load();this.changed();
   for(const file of files)await this.transformNote(file,text=>removeReferences(text,listReferences(text).filter(reference=>!this.getConnection(reference.connectionId)).map(reference=>reference.connectionId)));
   new Notice('Unavailable references removed. Captions and surrounding text were kept.');
  }));
 }
 async insertReference(connection:Connection,mode:'inline'|'compact'){
  const file=this.app.vault.getAbstractFileByPath(connection.notePath);if(!(file instanceof TFile))throw new Error('The attached note is missing. The caption is still saved.');
  const caption=this.app.vault.getAbstractFileByPath(connection.captionPath);
  const fallback=caption instanceof TFile?this.app.fileManager.generateMarkdownLink(caption,file.path,undefined,'Caption and source'):'';
  const addition=`\n\n${referenceMarkdown(connection.id,mode)}\n${fallback}\n`;
  const insert=(text:string)=>{
   if(!connection.blockId)return text+addition;
   const lines=text.split('\n');const index=lines.findIndex(l=>new RegExp(`\\^${connection.blockId}\\s*$`).test(l));
   if(index<0)throw new Error('The linked paragraph moved or was removed. Caption saved; use the region browser to open it.');
   lines.splice(index+1,0,addition);return lines.join('\n');
  };
  const open=this.app.workspace.getLeavesOfType('markdown').map(l=>l.view).find(v=>v instanceof MarkdownView&&v.file?.path===file.path) as MarkdownView|undefined;
  if(open){const editor=open.editor;const text=editor.getValue();const next=insert(text);let i=0;while(i<text.length&&text[i]===next[i])i++;editor.replaceRange(next.slice(i,next.length-(text.length-i)),editor.offsetToPos(i));}
  else await this.app.vault.process(file,insert);
 }
}

class ImageModal extends Modal {
 private handle?:RegionEditorHandle;
 private component=new Component();
 constructor(private plugin:ImageAnnotationPlugin,private source:MediaSource,private target?:TargetFactory,private selectedId?:string){super(plugin.app);}
 onOpen(){
  this.modalEl.addClass('ia-image-modal');this.setTitle('Annotate image');this.component.load();
  const cleanupLabel=this.contentEl.createEl('label');const cleanup=cleanupLabel.createEl('input',{type:'checkbox'});cleanupLabel.appendText(' When deleting a region, remove its previews from notes. Keep captions.');
  const canvas=this.contentEl.createDiv({cls:'ia-editor-host'});const attached=this.contentEl.createDiv({cls:'ia-attached'});
  this.handle=mountRegionEditor(canvas,{source:this.source,imageUrl:this.plugin.resourceUrl(this.source),regions:this.plugin.store.regionsForImage(this.source.path),selectedId:this.selectedId,
   onCreate:async(geometry,title)=>{const region=await this.plugin.store.createRegion(this.source,geometry,title);this.plugin.changed();new Notice('Region saved. Attach it to a note to add a caption.');return region;},
   onSelect:region=>{attached.empty();attached.createEl('h3',{text:`Notes attached to “${region.title}”`});const connections=this.plugin.getConnections(region.id);if(!connections.length)attached.createEl('p',{text:'No notes attached. Attach this region to a note to add a caption.'});for(const connection of connections){const row=attached.createDiv({cls:'ia-attached-row'});const link=row.createEl('button',{text:connection.notePath+(connection.blockId?' · paragraph':'')});link.onclick=()=>this.plugin.run(()=>this.plugin.openTarget(connection));const body=row.createDiv();this.plugin.run(async()=>{await MarkdownRenderer.render(this.app,await this.plugin.readCaption(connection),body,connection.captionPath,this.component);});const edit=row.createEl('button',{text:'Edit caption'});edit.onclick=()=>this.plugin.editCaption(connection);}},
   onAttach:region=>this.plugin.attach(region,this.target),
   onUpdate:async(region,geometry,title)=>{const updated=await this.plugin.store.updateRegion(region.id,geometry,title);this.plugin.changed();return updated;},
   onDelete:async(region)=>{await this.plugin.store.load();const ids=new Set(this.plugin.getConnections(region.id).map(connection=>connection.id));await this.plugin.store.removeRegion(region.id);attached.empty();this.plugin.changed();if(cleanup.checked){try{await this.plugin.removeNoteReferences(ids);}catch(e){new Notice(`Region removed, but some previews remain: ${message(e)}. Run Remove unavailable references to retry.`,10000);return;}}new Notice('Region removed. Caption notes were kept.');},
   onOpenArticle:()=>this.plugin.run(()=>this.plugin.openArticle({source:this.source} as Region))
  });
 }
 onClose(){this.handle?.destroy();this.component.unload();this.contentEl.empty();this.plugin.untrack(this);}
}

class AttachModal extends Modal {
 private selected?:TFile;
 constructor(private plugin:ImageAnnotationPlugin,private region:Region,private target?:TargetFactory){super(plugin.app);}
 onOpen(){
  this.setTitle(`Attach “${this.region.title}” to a note`);this.contentEl.addClass('ia-attach');
  const destination=this.contentEl.createEl('p',{text:this.target?'Destination: your selected paragraph':'Choose a note or enter a title to create one.'});
  if(!this.target){
   const choose=this.contentEl.createEl('button',{text:'Choose an existing note'});choose.onclick=()=>new Picker(this.app,this.app.vault.getMarkdownFiles().filter(f=>!f.path.startsWith('Image Annotation/Captions/')),f=>f.path,f=>{this.selected=f;destination.setText(`Destination: ${f.path}`);},'Choose a note').open();
  }
  const title=this.contentEl.createEl('input',{type:'text',placeholder:'New note title'});title.setAttribute('aria-label','New note title');if(this.target)title.hidden=true;
  const label=this.contentEl.createEl('label',{text:'Caption'});
  const caption=this.contentEl.createEl('textarea',{placeholder:'Describe the image region. Markdown and note links work here.'});caption.rows=5;caption.id=`ia-caption-${crypto.randomUUID()}`;label.htmlFor=caption.id;
  const modeLabel=this.contentEl.createEl('label',{text:'Display '});const mode=modeLabel.createEl('select');mode.createEl('option',{text:'Image and caption',value:'inline'});mode.createEl('option',{text:'Collapsed preview',value:'compact'});
  const error=this.contentEl.createEl('p',{cls:'ia-error'});error.setAttribute('role','alert');
  const save=this.contentEl.createEl('button',{text:'Attach to note',cls:'mod-cta'});
  save.onclick=()=>{save.disabled=true;void(async()=>{
   if(!caption.value.trim())throw new Error('Write a caption.');
   let passage:PassageTarget;
   if(this.target)passage=this.target();
   else if(this.selected)passage={notePath:this.selected.path};
   else {
    const name=title.value.trim().replace(/[\\/:*?"<>|#[\]]/g,'-');if(!name)throw new Error('Choose a note or enter a new note title.');
    const path=`${name}.md`;if(this.app.vault.getAbstractFileByPath(path))throw new Error('That note exists. Choose it using the existing-note button.');
    const created=await this.app.vault.create(path,`# ${name}\n\n`);this.selected=created;passage={notePath:created.path};
   }
   const connection=await this.plugin.store.connect(this.region.id,passage,caption.value.trim());
   this.plugin.changed();
   try{await this.plugin.insertReference(connection,mode.value as 'inline'|'compact');}catch(e){new Notice(`Caption saved, but the preview could not be added: ${message(e)}`,10000);this.close();return;}
   new Notice('Image region attached to note.');this.close();await this.plugin.openTarget(connection);
  })().catch(e=>{error.setText(message(e));save.disabled=false;});};
 }
 onClose(){this.contentEl.empty();this.plugin.untrack(this);}
}

class ReviewModal extends Modal {
 constructor(private plugin:ImageAnnotationPlugin,private title:string,private paths:string[],private actionLabel:string,private action:()=>Promise<void>){super(plugin.app);}
 onOpen(){
  this.setTitle(this.title);
  this.contentEl.createEl('p',{text:'Review the affected files before continuing.'});
  const list=this.contentEl.createEl('ul');for(const path of this.paths)list.createEl('li',{text:path});
  const error=this.contentEl.createEl('p',{cls:'ia-error'});error.setAttribute('role','alert');
  const cancel=this.contentEl.createEl('button',{text:'Cancel'});cancel.onclick=()=>this.close();
  const apply=this.contentEl.createEl('button',{text:this.actionLabel,cls:'mod-warning'});
  apply.onclick=()=>{apply.disabled=true;cancel.disabled=true;void this.action().then(()=>this.close()).catch((reason:unknown)=>{error.setText(message(reason));apply.disabled=false;cancel.disabled=false;});};
 }
 onClose(){this.contentEl.empty();this.plugin.untrack(this);}
}

class CleanupProgressModal extends Modal {
 readonly controller=new AbortController();
 private status?:HTMLElement;
 constructor(private plugin:ImageAnnotationPlugin){super(plugin.app);}
 onOpen(){
  this.setTitle('Checking image snapshots');
  this.status=this.contentEl.createEl('p',{text:'Checking references…'});
  const cancel=this.contentEl.createEl('button',{text:'Cancel'});cancel.onclick=()=>this.close();
 }
 progress(done:number,total:number){this.status?.setText(`Checked ${done} of ${total} documents. Keeping referenced images safe.`);}
 onClose(){this.controller.abort();this.plugin.untrack(this);}
}

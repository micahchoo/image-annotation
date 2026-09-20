// Run through scripts/obsidian-eval.mjs with an image visible in the active note.
(async () => {
 const doc=app.workspace.containerEl.ownerDocument;
 doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 const image=[...doc.querySelectorAll('.markdown-source-view img,.markdown-preview-view img')].find(el=>{const r=el.getBoundingClientRect();return r.width>100&&r.height>100&&r.top<doc.defaultView.innerHeight&&r.bottom>0;});
 if(!image)throw new Error('Open a note with a visible image before this check.');
 const r=image.getBoundingClientRect();
 image.dispatchEvent(new doc.defaultView.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:r.left+50,clientY:Math.max(r.top+50,100)}));
 await new Promise(resolve=>setTimeout(resolve,100));
 const menus=[...doc.querySelectorAll('.menu')].filter(el=>el.getBoundingClientRect().width>0);
 const text=menus.map(el=>el.textContent);
 const annotationCount=menus.flatMap(el=>[...el.querySelectorAll('.menu-item-title')]).filter(el=>el.textContent==='Annotate image').length;
 const result={pass:menus.length===1&&annotationCount===1&&text[0].includes('Copy image'),count:menus.length,annotationCount,menus:text};
 globalThis.__regionMenuCheck=result;
 return JSON.stringify(result);
})().catch(error => {
 const result={pass:false,error:error.message};
 globalThis.__regionMenuCheck=result;
 return JSON.stringify(result);
});

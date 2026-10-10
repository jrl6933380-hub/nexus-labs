const make=(tag,text,cls='')=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;node.className=cls;return node;};
const button=(label,run,cls='')=>{const node=make('button',label,cls);node.type='button';node.onclick=run;return node;};
export function editProjectElement(html,id,change){
  const doc=new DOMParser().parseFromString(html,'text/html');const nodes=[...doc.querySelectorAll('h1,h2,h3,h4,p,button,a,img,label,li')];const target=nodes[Number(id)];
  if(!target)throw new Error('That element changed. Select it again.');
  if(change.text!==undefined && target.tagName!=='IMG')target.textContent=String(change.text);
  if(change.src && target.tagName==='IMG'){if(!/^data:image\/(?:png|jpeg|webp);base64,/i.test(change.src))throw new Error('Choose a photo from your gallery.');target.src=change.src;}
  if(change.color)target.style.color=change.color;
  if(change.fontSize)target.style.fontSize=`${Math.max(10,Math.min(100,Number(change.fontSize)))}px`;
  return '<!doctype html>'+doc.documentElement.outerHTML;
}
function previewDocument(html,token,mode){
  const doc=new DOMParser().parseFromString(html,'text/html');[...doc.querySelectorAll('h1,h2,h3,h4,p,button,a,img,label,li')].forEach((node,index)=>node.setAttribute('data-nexus-element',String(index)));
  const script=doc.createElement('script');script.textContent=`(()=>{const token=${JSON.stringify(token)};let mode=${JSON.stringify(mode)},chosen=null;const tell=(type,more={})=>parent.postMessage({nexusBuilder:token,type,...more},'*');addEventListener('message',e=>{if(e.source!==parent || e.data?.nexusBuilder!==token)return;if(e.data.type==='mode'){mode=e.data.mode;if(mode!=='fine'){chosen?.style.removeProperty('outline');chosen=null;}}if(e.data.type==='scroll')scrollTo(e.data.x,e.data.y);});addEventListener('click',e=>{if(mode!=='fine')return;e.preventDefault();e.stopImmediatePropagation();const n=e.target.closest('[data-nexus-element]');if(!n)return;chosen?.style.removeProperty('outline');chosen=n;n.style.outline='2px solid #d8b972';const style=getComputedStyle(n);tell('select',{id:n.dataset.nexusElement,tag:n.tagName,text:n.tagName==='IMG'?'':n.textContent,color:style.color,fontSize:parseFloat(style.fontSize)});},true);let timer;addEventListener('scroll',()=>{clearTimeout(timer);timer=setTimeout(()=>tell('scroll',{x:scrollX,y:scrollY}),80);});tell('ready');})();`;
  doc.body.append(script);return '<!doctype html>'+doc.documentElement.outerHTML;
}
export function preferredBuilderMode(){try{const mode=localStorage.getItem('nexus:builder-mode');return ['preview','build','fine'].includes(mode)?mode:'build';}catch{return 'build';}}
export function mountProjectBuilder({projectId,label,html,buildId,conversation,mode='build',onMode,onExit,onPublish,onSave,onRestore,onRetrySave,onPiece,onOptions,sourceConversation}){
  const shell=make('section',undefined,'projectbuilder');shell.setAttribute('aria-label','Project builder');
  const top=make('header',undefined,'pb-top'),status=make('span','Saved draft','pb-status');const title=make('strong',label);status.setAttribute('role','status');status.setAttribute('aria-live','polite');const back=button('‹ Projects',onExit);back.setAttribute('aria-label','Back to Projects');const topAction=button('Open',()=>setMode('preview'),'pb-gold');top.append(back,title,topAction);shell.append(top,status);
  const stage=make('div',undefined,'pb-stage'),frame=make('iframe');frame.title='Interactive project preview';frame.setAttribute('sandbox','allow-scripts allow-forms');frame.setAttribute('referrerpolicy','no-referrer');const canvas=make('div',undefined,'pb-canvas');canvas.append(frame);stage.append(canvas);
  const chat=make('div',undefined,'pb-chat');
  const chatToggle=button('Chat with Nex ↑',()=>{if(currentMode==='build'){conversation.querySelector('input')?.blur();setMode('overview');}else setMode('build');},'pb-chat-toggle');
  const originalConversationId=conversation.id;
  chatToggle.setAttribute('aria-controls','pb-project-conversation');conversation.id='pb-project-conversation';
  const anchor=document.createComment('Project conversation');conversation.before(anchor);chat.append(chatToggle,conversation);stage.append(chat);shell.append(stage);
  const expandChat=()=>{if(currentMode==='overview')setMode('build');};
  conversation.addEventListener('focusin',expandChat);
  const panel=make('section',undefined,'pb-sheet');panel.hidden=true;panel.setAttribute('aria-label','Fine-tune selection');shell.append(panel);
  const controls=[];const makeModeControl=(key,name)=>{const control=button(name,()=>setMode(key));control.dataset.builderMode=key;controls.push(control);return control;};
  const dock=make('footer',undefined,'pb-dock'),modes=make('nav');modes.setAttribute('aria-label','Builder mode');for(const [key,name] of [['preview','Preview'],['build','Build with Nex'],['fine','Fine-tune']])modes.append(makeModeControl(key,name));dock.append(modes);
  const actions=make('div',undefined,'pb-tools');actions.setAttribute('aria-label','Project controls');actions.append(button('Home page',()=>setMode('preview')),button('Add a piece',onPiece),button('Team activity',activity),button('Project pieces',pieces),button('Versions',versions),button('Project options',onOptions));dock.append(actions);shell.append(dock);document.body.append(shell);
  let stableViewportHeight=window.visualViewport?.height || window.innerHeight;
  const fitViewport=()=>{
    const height=window.visualViewport?.height || window.innerHeight;
    const typing=conversation.contains(document.activeElement) && document.activeElement.matches('input,textarea');
    if(!typing || height>=stableViewportHeight-100)stableViewportHeight=height;
    shell.style.height=height+'px';shell.style.top=(window.visualViewport?.offsetTop || 0)+'px';shell.style.bottom='auto';
    shell.style.setProperty('--pb-site-height',Math.max(1,stableViewportHeight-top.offsetHeight-status.offsetHeight-dock.offsetHeight)+'px');
  };
  const composer=conversation.querySelector('.foot');
  const sizeObserver=new ResizeObserver(()=>{if(composer.offsetHeight)shell.style.setProperty('--pb-collapsed-chat-height',(chatToggle.offsetHeight+composer.offsetHeight)+'px');shell.style.setProperty('--pb-dock-height',dock.offsetHeight+'px');shell.style.setProperty('--pb-top-height',(top.offsetHeight+status.offsetHeight)+'px');fitViewport();});
  sizeObserver.observe(dock);sizeObserver.observe(top);sizeObserver.observe(status);sizeObserver.observe(composer);sizeObserver.observe(chatToggle);fitViewport();
  window.visualViewport?.addEventListener('resize',fitViewport);window.visualViewport?.addEventListener('scroll',fitViewport);
  const token=crypto.randomUUID();let currentHtml=html,currentId=buildId,currentMode=mode,returnMode='overview',selection=null,proposed=null,busy=false,beforePreview=false,scroll={x:0,y:0},undoId=null,persistenceError='',saving=false;
  function renderFrame(content=currentHtml){frame.srcdoc=previewDocument(content,token,currentMode);}
  function setMode(value){
    if(value!==currentMode && ['preview','fine'].includes(value) && ['build','overview'].includes(currentMode))returnMode=currentMode;
    currentMode=value;onMode?.(value);shell.dataset.mode=value;
    const backMode=['preview','fine'].includes(value)?returnMode:'overview';
    back.onclick=value==='overview'?onExit:()=>setMode(backMode);
    back.setAttribute('aria-label',value==='overview'?'Back to Projects':backMode==='build'?'Back to Build with Nex':'Back to project');
    canvas.setAttribute('aria-hidden','false');frame.tabIndex=0;
    chatToggle.textContent=value==='build'?'Hide chat ↓':'Chat with Nex ↑';chatToggle.setAttribute('aria-expanded',String(value==='build'));
    conversation.querySelector('.thread').setAttribute('aria-hidden',String(value!=='build'));
    for(const control of controls)control.setAttribute('aria-pressed',String(control.dataset.builderMode===value));
    frame.contentWindow?.postMessage({nexusBuilder:token,type:'mode',mode:value},'*');panel.hidden=true;
    topAction.textContent='Publish';topAction.onclick=publishProject;
    if(value==='fine'){if(selection)editSheet();else status.textContent='Tap a heading, image, or button to fine-tune.';}
    else status.textContent=proposed?'Unsaved preview':'Saved draft';
    if(saving)status.textContent='Saving this version…';if(persistenceError)markUnsaved(persistenceError);
    if(value!=='overview')try{localStorage.setItem('nexus:builder-mode',value);}catch{}
  }
  function receive(event){if(event.source!==frame.contentWindow || event.data?.nexusBuilder!==token)return;const message=event.data;if(message.type==='ready')frame.contentWindow.postMessage({nexusBuilder:token,type:'scroll',...scroll},'*');if(message.type==='scroll' && Number.isFinite(message.x) && Number.isFinite(message.y))scroll={x:message.x,y:message.y};if(message.type==='select' && currentMode==='fine' && /^\d{1,5}$/.test(message.id)){selection={id:message.id,tag:String(message.tag),text:String(message.text || '').slice(0,8000),draft:{text:String(message.text || '').slice(0,8000),color:'#edf3ee',fontSize:'',src:null}};editSheet();}}
  window.addEventListener('message',receive);renderFrame();setMode(mode);
  function closePanel(){panel.hidden=true;}
  function editSheet(){
    panel.replaceChildren();panel.hidden=false;panel.append(make('h2',selection.tag==='IMG'?'Edit this image':'Edit this element'));
    const text=make('textarea');text.value=selection.draft.text;text.oninput=()=>selection.draft.text=text.value;text.setAttribute('aria-label','Element text');const color=make('input');color.type='color';color.value=selection.draft.color;if(selection.draft.colorChanged)color.dataset.changed='true';color.setAttribute('aria-label','Text color');const size=make('input');size.type='number';size.min=10;size.max=100;size.placeholder='Size';size.setAttribute('aria-label','Font size');size.value=selection.draft.fontSize;size.oninput=()=>selection.draft.fontSize=size.value;
    if(selection.tag!=='IMG')panel.append(text,make('label','Text color'),color,make('label','Font size'),size);
    let photo=selection.draft.src;if(selection.tag==='IMG'){const input=make('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';input.setAttribute('aria-label','Choose image from Photos');input.onchange=async()=>{const file=input.files?.[0];if(!file)return;try{if(file.size>5e6)throw new Error('Choose an image under 5 MB.');busy=true;status.textContent='Preparing photo…';photo=await prepareProjectPhoto(file,Math.max(0,95000-currentHtml.length));selection.draft.src=photo;status.textContent='Photo ready · Preview or save';}catch(error){status.textContent=error.message;}finally{busy=false;}};panel.append(input);}
    const changes=()=>({...selection.tag!=='IMG'?{text:text.value}:photo?{src:photo}:{},...(color.dataset.changed?{color:color.value}:{}),...(size.value?{fontSize:size.value}:{})});color.oninput=()=>{color.dataset.changed='true';selection.draft.color=color.value;selection.draft.colorChanged=true;};
    const row=make('div',undefined,'pb-sheetactions');row.append(button('Cancel',()=>{proposed=null;renderFrame();closePanel();status.textContent='Saved draft';}),button('Preview change',()=>{try{proposed=editProjectElement(currentHtml,selection.id,changes());renderFrame(proposed);status.textContent='Unsaved preview';beforePreview=false;}catch(error){status.textContent=error.message;}}),button('Before / after',()=>{if(!proposed)return;beforePreview=!beforePreview;renderFrame(beforePreview?currentHtml:proposed);status.textContent=beforePreview?'Before change':'After change · unsaved';}),button('Save change',async()=>{if(busy)return;try{proposed=editProjectElement(currentHtml,selection.id,changes());busy=true;status.textContent='Saving…';const previous=currentId;const saved=await onSave(proposed,currentId);undoId=previous;update(saved.html,saved.id);selection=null;closePanel();status.textContent='Saved · Undo available';}catch(error){status.textContent=error.message;}finally{busy=false;}},'pb-gold'));panel.append(row);
  }
  async function versions(){panel.replaceChildren(make('h2','Versions'),make('p','Loading saved versions…'),button('Close',closePanel));panel.hidden=false;try{const response=await fetch('/api/room-history',{credentials:'include',cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error || 'Versions could not load');panel.replaceChildren(make('h2','Versions'));const project=data.projects.find(item=>item.projectId===projectId);const builds=data.builds.filter(item=>item.projectId===projectId);if(undoId)panel.append(button('Undo last change',()=>restore(undoId)));for(const build of builds){const row=make('div',undefined,'pb-version');row.append(make('span',`${new Date(build.createdAt).toLocaleString()}${build.id===currentId?' · Current':''}`));if(build.id!==currentId)row.append(button('Preview',async()=>{try{const response=await fetch('/api/room-history?id='+encodeURIComponent(build.id),{credentials:'include'}),data=await response.json();if(!response.ok)throw new Error(data.error);renderFrame(data.build.html);status.textContent='Viewing previous version';}catch(error){status.textContent=error.message;}}),button('Restore',()=>restore(build.id)));panel.append(row);}panel.append(button('Return to current',()=>{renderFrame(proposed || currentHtml);closePanel();}));}catch(error){panel.replaceChildren(make('p',error.message),button('Try again',versions),button('Close',closePanel));}}
  async function restore(id){if(busy)return;busy=true;try{const previous=currentId;const saved=await onRestore(id,currentId);undoId=previous;update(saved.html,saved.id);selection=null;closePanel();status.textContent='Version restored';}catch(error){status.textContent=error.message;}finally{busy=false;}}
  async function pieces(){panel.replaceChildren(make('h2','Project pieces'),button('Add a piece',onPiece),button('Close',closePanel));panel.hidden=false;try{const response=await fetch('/api/room-history',{credentials:'include'}),data=await response.json();if(!response.ok)throw new Error(data.error);const project=data.projects.find(item=>item.projectId===projectId);panel.append(make('p',project?.mainLabel || label));for(const piece of project?.stackItems || [])panel.append(make('p',piece.label));panel.append(button('Team activity',activity));}catch(error){panel.append(make('p',error.message));}}
  async function activity(){
    panel.replaceChildren(make('h2','Team activity'),button('Close',closePanel));panel.hidden=false;
    if(!sourceConversation){panel.append(make('p','No team activity is linked to this project yet.'));return;}
    const content=make('div');content.append(make('p','Loading activity…'));panel.append(content);
    try{
      const path=sourceConversation.kind==='team'?'/api/nexus-messages?group_id=':'/api/chat?threadId=';
      const response=await fetch(path+encodeURIComponent(sourceConversation.id),{credentials:'include'}),data=await response.json();
      if(!response.ok)throw new Error(data.error || 'Activity could not load');
      content.replaceChildren();
      const clean=value=>String(value || '').replace(/```html[\s\S]*?```/giu,'[Saved project preview]').slice(0,4000);
      if(data.runs){for(const run of data.runs.filter(run=>!sourceConversation.runId || run.id===sourceConversation.runId))for(const step of run.steps || [])content.append(make('p',`${step.name}: ${clean(step.result || step.state)}`));}
      else for(const message of data.messages || [])content.append(make('p',clean(message.content)));
      if(!content.childElementCount)content.append(make('p','No activity yet.'));
    }catch(error){content.replaceChildren(make('p',error.message),button('Try again',activity));}
  }
  async function publishProject(){try{status.textContent='Publishing…';await onPublish();status.textContent='Live link copied';}catch(error){status.textContent=error.message;}}
  function markSaving(){saving=true;topAction.disabled=true;status.textContent='Saving this version…';}
  function markUnsaved(message){saving=false;topAction.disabled=true;persistenceError=message;status.textContent='Unsaved · '+message;if(onRetrySave)status.append(button('Retry saving',async()=>{if(busy)return;busy=true;try{const saved=await onRetrySave(currentHtml,currentId);update(saved.html,saved.id);}catch(error){markUnsaved(error.message);}finally{busy=false;}}));}
  function update(nextHtml,nextId){saving=false;topAction.disabled=false;persistenceError='';currentHtml=nextHtml;currentId=nextId;proposed=null;renderFrame();status.textContent='Saved draft';}
  return {projectId,setMode,update,markUnsaved,markSaving,updateLabel(value){title.textContent=value;},destroy(){conversation.removeEventListener('focusin',expandChat);conversation.id=originalConversationId;conversation.querySelector('.thread').removeAttribute('aria-hidden');sizeObserver.disconnect();window.visualViewport?.removeEventListener('resize',fitViewport);window.visualViewport?.removeEventListener('scroll',fitViewport);window.removeEventListener('message',receive);anchor.replaceWith(conversation);shell.remove();}};
}

async function prepareProjectPhoto(file,budget){
  if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Choose a PNG, JPEG, or WebP photo.');
  const url=URL.createObjectURL(file);
  try{
    const image=new Image();image.src=url;await image.decode();
    const canvas=document.createElement('canvas');let edge=1024;
    for(let attempt=0;attempt<7;attempt++){
      const scale=Math.min(1,edge/Math.max(image.naturalWidth,image.naturalHeight));canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));const context=canvas.getContext('2d');context.drawImage(image,0,0,canvas.width,canvas.height);const result=canvas.toDataURL('image/webp',.78);
      if(result.length<=budget)return result;edge=Math.floor(edge*.7);
    }
    throw new Error('This project has no room for an embedded photo. Remove an existing image first.');
  }finally{URL.revokeObjectURL(url);}
}

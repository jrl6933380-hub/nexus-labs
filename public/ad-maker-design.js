// Custom creative runs in a separate opaque iframe, never in the studio or board.
export function validateAdDesign(value){
 if(value==null)return null;
 if(typeof value!=='object'||Array.isArray(value)||typeof value.name!=='string'||!value.name.trim()||value.name.length>80||typeof value.html!=='string'||value.html.length>100000||!/<html\b|<!doctype\s+html/i.test(value.html)||!value.html.includes('renderAdFrame'))throw Error('Use a named, complete HTML design (under 100,000 characters) defining window.renderAdFrame(frame).');
 return {name:value.name,html:value.html};
}
export function createAdDesignRenderer(stage,report=()=>{}){
 let current=null,frame=null,nonce='',ready=false,last=null,wait=Promise.resolve(),resolveReady,rejectReady,timer,config=null,configVersion=0,sentVersion=-1;
 const error=document.createElement('div');error.className='design-error';error.hidden=true;stage.append(error);
 const send=()=>{if(ready&&frame&&last){frame.contentWindow.postMessage({type:'nexus-design-frame',nonce,frame:{...last,...(sentVersion!==configVersion?{project:config}:{})}},'*');sentVersion=configVersion;}};
 window.addEventListener('message',e=>{
  if(!frame||e.source!==frame.contentWindow||e.data?.nonce!==nonce)return;
  if(e.data.type==='nexus-design-ready'){clearTimeout(timer);ready=true;error.hidden=true;resolveReady?.();send();}
  if(e.data.type==='nexus-design-error'){clearTimeout(timer);ready=false;const message='Design preview: '+String(e.data.message||'could not render').slice(0,250);error.textContent=message;error.hidden=false;report(message);rejectReady?.(Error(message));}
 });
 return {
  set(value){
   const next=validateAdDesign(value);if(JSON.stringify(next)===JSON.stringify(current))return;
   clearTimeout(timer);rejectReady?.(Error('Design changed.'));frame?.remove();frame=null;current=next;ready=false;error.hidden=true;
   stage.dataset.design=next?'custom':'template';if(!next){wait=Promise.resolve();return;}
   nonce=crypto.randomUUID();sentVersion=-1;wait=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});wait.catch(()=>{});
   frame=document.createElement('iframe');frame.className='ad-custom-frame';frame.title=next.name+' ad canvas';frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('referrerpolicy','no-referrer');
   const doc=new DOMParser().parseFromString(next.html,'text/html');const csp=doc.createElement('meta');csp.httpEquiv='Content-Security-Policy';csp.content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";doc.head.prepend(csp);
   const bridge=doc.createElement('script');bridge.textContent=`(()=>{const nonce=${JSON.stringify(nonce)};let project=null;const fail=e=>parent.postMessage({type:'nexus-design-error',nonce,message:String(e?.message||e).slice(0,250)},'*');window.addEventListener('message',e=>{if(e.source!==parent||e.data?.type!=='nexus-design-frame'||e.data.nonce!==nonce)return;try{if(e.data.frame.project)project=e.data.frame.project;window.renderAdFrame({...e.data.frame,project});}catch(error){fail(error);}});window.addEventListener('load',()=>{if(typeof window.renderAdFrame!=='function')return fail('Define window.renderAdFrame(frame).');parent.postMessage({type:'nexus-design-ready',nonce},'*');});})();`;
   doc.body.append(bridge);frame.srcdoc='<!doctype html>'+doc.documentElement.outerHTML;stage.append(frame);error.textContent='Loading your design…';error.hidden=false;
   timer=setTimeout(()=>{if(!ready){const message='Design did not become ready. Check its renderAdFrame function.';error.textContent=message;report(message);rejectReady?.(Error(message));}},10000);
  },
  configure(project){config=project;configVersion++;},
  update(value){last=value;send();},
  get design(){return current?{...current}:null;},get ready(){return !current||ready;},get wait(){return wait;}
 };
}

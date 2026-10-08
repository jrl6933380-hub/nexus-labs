// Agent output is untrusted. Preview only in an opaque sandbox with no
// network, navigation, popups, downloads, forms, or access to the parent.
export function chatVisualHtml(result) {
  const match=String(result || '').match(/```html\s*\n([\s\S]*?)\n```/iu);
  if(!match || match[1].length>50000)return null;
  return match[1];
}
export function chatVisualDocument(result) {
  const html=chatVisualHtml(result);if(!html)return null;
  return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'"></head><body>'+html+'</body></html>';
}
export function appendChatVisual(host,result,name,{onPromote}={}) {
  const html=chatVisualHtml(result),doc=chatVisualDocument(result);if(!html || !doc)return null;
  const frame=document.createElement('iframe');frame.title=`${name} visual preview`;frame.className='teamvisual';frame.setAttribute('sandbox','');frame.setAttribute('referrerpolicy','no-referrer');const parsed=new DOMParser().parseFromString(doc,'text/html');
  parsed.querySelectorAll('script,iframe,object,embed,link,base,meta[http-equiv=refresh]').forEach(element=>element.remove());
  parsed.querySelectorAll('*').forEach(element=>{for(const attribute of [...element.attributes])if(/^on/iu.test(attribute.name) || ['href','xlink:href','action','formaction','srcdoc','autofocus'].includes(attribute.name.toLowerCase()))element.removeAttribute(attribute.name);});
  frame.srcdoc='<!doctype html>'+parsed.documentElement.outerHTML;host.append(frame);
  if(typeof onPromote==='function'){
    const actions=document.createElement('div');actions.className='teamvisualactions';
    const keep=document.createElement('button');keep.type='button';keep.className='teamgold';keep.textContent='Keep building this';
    const note=document.createElement('small');note.textContent='Saves it to Projects and opens the visual Workbench.';
    keep.onclick=async()=>{keep.disabled=true;keep.textContent='Saving to Projects…';try{await onPromote({html,name});keep.textContent='Opening Workbench…';}catch(error){keep.disabled=false;keep.textContent='Keep building this';note.textContent=error?.message || 'This build could not be saved.';note.classList.add('teamerror');}};
    actions.append(keep,note);host.append(actions);
  }
  return frame;
}

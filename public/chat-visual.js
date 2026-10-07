// Agent output is untrusted. Preview only in an opaque sandbox with no
// network, navigation, popups, downloads, forms, or access to the parent.
export function chatVisualDocument(result) {
  const match=String(result || '').match(/```html\s*\n([\s\S]*?)\n```/iu);
  if(!match || match[1].length>50000)return null;
  return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'"></head><body>'+match[1]+'</body></html>';
}
export function appendChatVisual(host,result,name) {
  const doc=chatVisualDocument(result);if(!doc)return null;
  const frame=document.createElement('iframe');frame.title=`${name} visual preview`;frame.className='teamvisual';frame.setAttribute('sandbox','');frame.setAttribute('referrerpolicy','no-referrer');const parsed=new DOMParser().parseFromString(doc,'text/html');
  parsed.querySelectorAll('script,iframe,object,embed,link,base,meta[http-equiv=refresh]').forEach(element=>element.remove());
  parsed.querySelectorAll('*').forEach(element=>{for(const attribute of [...element.attributes])if(/^on/iu.test(attribute.name) || ['href','xlink:href','action','formaction','srcdoc','autofocus'].includes(attribute.name.toLowerCase()))element.removeAttribute(attribute.name);});
  frame.srcdoc='<!doctype html>'+parsed.documentElement.outerHTML;host.append(frame);return frame;
}

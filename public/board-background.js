// Still artwork only. SVG image decoding disables scripts and external resources;
// the inert template also removes active elements before HTML is serialized.
import {outputSize} from './board-compose-core.js';
const SVG_NS='http://www.w3.org/2000/svg';
export const TRIPPY_VISUAL='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1350"><defs><radialGradient id="glow"><stop stop-color="#fa69dd"/><stop offset=".45" stop-color="#632ee3"/><stop offset="1" stop-color="#070c25"/></radialGradient><pattern id="rings" width="240" height="240" patternUnits="userSpaceOnUse"><circle cx="120" cy="120" r="110" fill="none" stroke="#50f8d7" stroke-width="5"/><circle cx="120" cy="120" r="70" fill="none" stroke="#efb859" stroke-width="3"/></pattern></defs><path fill="url(#glow)" d="M0 0h1080v1350H0z"/><path fill="url(#rings)" opacity=".6" d="M0 0h1080v1350H0z"/><ellipse cx="540" cy="660" rx="380" ry="470" fill="none" stroke="#b8fff1" stroke-width="12"/><ellipse cx="540" cy="660" rx="300" ry="390" fill="none" stroke="#ff93e6" stroke-width="10"/></svg>';
export function visualSvg(code,width,height){
  if(typeof code!=='string'||!code.trim()||code.length>60000)throw Error('Paste HTML or SVG artwork under 60,000 characters.');
  const size=outputSize(Number(width),Number(height));
  const template=document.createElement('template');template.innerHTML=code;
  template.content.querySelectorAll('script,iframe,frame,object,embed,link,meta,base,form,input,button,textarea,select,video,audio,canvas,animate,animateMotion,animateTransform,set').forEach(n=>n.remove());
  for(const n of template.content.querySelectorAll('*')){
    for(const a of [...n.attributes]){
      if(/^on/i.test(a.name)||['srcdoc','srcset','action','formaction'].includes(a.name.toLowerCase()))n.removeAttribute(a.name);
      if(['src','href','xlink:href'].includes(a.name.toLowerCase())&&!/^(#[\w-]+|data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+)$/i.test(a.value))n.removeAttribute(a.name);
    }
  }
  const top=[...template.content.children];
  const root=top.length===1&&top[0].namespaceURI===SVG_NS&&top[0].localName==='svg'?top[0]:null;
  const serializer=new XMLSerializer();
  if(root){
    if(!root.getAttribute('viewBox'))root.setAttribute('viewBox','0 0 '+(parseFloat(root.getAttribute('width'))||size.width)+' '+(parseFloat(root.getAttribute('height'))||size.height));
    root.setAttribute('width',size.width);root.setAttribute('height',size.height);
    return {svg:serializer.serializeToString(root),...size};
  }
  const div=document.createElement('div');div.setAttribute('xmlns','http://www.w3.org/1999/xhtml');
  div.setAttribute('style','width:'+size.width+'px;height:'+size.height+'px;overflow:hidden;margin:0;background:#071016;color:white;font-family:Arial,sans-serif');
  div.append(template.content);
  return {svg:'<svg xmlns="'+SVG_NS+'" width="'+size.width+'" height="'+size.height+'"><foreignObject width="100%" height="100%">'+serializer.serializeToString(div)+'</foreignObject></svg>',...size};
}
export async function rasterizeVisual(code,width=1080,height=1350){
  const {svg,width:w,height:h}=visualSvg(code,width,height);
  const image=new Image();
  // A data URL keeps foreignObject exports origin-clean in Chrome.
  image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('Could not draw this artwork. Try a self-contained SVG.'));});
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  canvas.getContext('2d').drawImage(image,0,0,w,h);
  let blob;
  try{blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Could not capture this artwork.')),'image/png'));}
  catch{throw Error('This artwork cannot be exported. Use self-contained SVG with embedded images.');}
  return {blob,width:w,height:h};
}

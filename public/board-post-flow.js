import {FLOW_LIMIT} from './board-post-flow-core.js?v=20261101';
import {LABELS,LINKS,captionOf} from './social-post-flow-core.mjs';
const node=(tag,attrs={},text)=>{const n=document.createElement(tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;};
export function renderPostFlow(el,item,{items,assign,remove,change,mediaUrl,toast}){
 const rows=item.flow_rows||[],sig=JSON.stringify([rows,items.filter(i=>i.kind==='video').map(i=>[i.id,i.media_id,i.title])]);
 if(el._flowSig===sig)return;el._flowSig=sig;
 el.replaceChildren();el.classList.add('canvas-post-flow');
 const header=node('div',{class:'flow-heading'},`POST FLOW · ${rows.length} / ${FLOW_LIMIT} videos`);el.append(header);
 function action(text,run){const b=node('button',{type:'button'},text);b.onclick=async()=>{try{await run();}catch(e){if(e.name!=='AbortError')toast(e.message,true);}};return b;}
 function slot(index,full){
  const s=node('div',{class:'flow-slot','data-flow-slot':index});
  s.append(node('span',{},full?'Drop a video here':'＋ Drop next video'));
  const select=node('select',{'aria-label':`Choose board video for slot ${index+1}`});select.append(node('option',{value:''},'Choose board video…'));
  for(const v of items.filter(i=>i.kind==='video'))select.append(node('option',{value:v.id},v.title||v.id));
  select.onchange=()=>{const v=items.find(i=>i.id===select.value);if(v)assign(index,v);};s.append(select);return s;
 }
 function rowView(row,index){
  const wrap=node('div',{class:'flow-row','data-flow-row':index});
  const s=slot(index,true);s.firstChild.textContent=row.title||`Video ${index+1}`;s.firstChild.setAttribute('title',row.title||`Video ${index+1}`);
  const video=node('video',{controls:'',playsinline:'',preload:'metadata','aria-label':row.title||`Video ${index+1}`});
  s.insertBefore(video,s.children[1]);mediaUrl(row.media_id).then(url=>{if(video.isConnected)video.src=url;}).catch(e=>{s.firstChild.textContent=e.message;});
  const middle=node('div',{class:'flow-copy'});
  for(const [key,label,max] of [['caption','Caption',1600],['hashtags','Tags',400]]){
   const l=node('label',{},label),ta=node('textarea',{'aria-label':`${label} for video ${index+1}`,maxlength:max,rows:key==='caption'?3:2});ta.value=row[key]||'';
   ta.oninput=()=>{change(index,key,ta.value);el._flowSig=JSON.stringify([rows,items.filter(i=>i.kind==='video').map(i=>[i.id,i.media_id,i.title])]);};l.append(ta);middle.append(l);
  }
  const end=node('div',{class:'flow-end'}),platform=node('select',{'aria-label':`Platform for video ${index+1}`});
  for(const [key,label] of Object.entries(LABELS))platform.append(node('option',{value:key},label));platform.value=row.platform;platform.onchange=()=>{change(index,'platform',platform.value);open.href=LINKS[platform.value];open.textContent='Open '+LABELS[platform.value];};
  const open=node('a',{href:LINKS[row.platform],target:'_blank',rel:'noopener'},'Open '+LABELS[row.platform]);
  end.append(platform,action('Copy caption + tags',async()=>{await navigator.clipboard.writeText(captionOf(row));toast('Caption and tags copied.');}),action('Get / share video',async()=>{
   const response=await fetch(await mediaUrl(row.media_id)),blob=await response.blob(),file=new File([blob],(row.title||'video')+'.'+(blob.type==='video/webm'?'webm':blob.type==='video/quicktime'?'mov':'mp4'),{type:blob.type});
   if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file],title:row.title});
   else{const url=URL.createObjectURL(file),a=node('a',{href:url,download:file.name});a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);toast('Video download prepared.');}
  }),open,action('Remove from flow',()=>remove(index)));
  wrap.append(s,node('span',{class:'flow-arrow','aria-hidden':'true'},'→'),middle,node('span',{class:'flow-arrow','aria-hidden':'true'},'→'),end);return wrap;
 }
 if(rows.length)rows.forEach((row,i)=>el.append(rowView(row,i)));
 else{const r=node('div',{class:'flow-row flow-empty'});r.append(slot(0,true),node('span',{class:'flow-arrow','aria-hidden':'true'},'→'),node('div',{class:'flow-copy'},'Caption + tags'),node('span',{class:'flow-arrow','aria-hidden':'true'},'→'),node('div',{class:'flow-end'},'Social app'));el.append(r);}
 if(rows.length&&rows.length<FLOW_LIMIT)el.append(slot(rows.length,false));
 for(const control of el.querySelectorAll('input,textarea,select,button,a,video')){
  control.addEventListener('pointerdown',e=>e.stopPropagation());control.addEventListener('keydown',e=>e.stopPropagation());control.addEventListener('wheel',e=>e.stopPropagation());
 }
}

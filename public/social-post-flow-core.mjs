export const PLATFORMS=['tiktok','instagram','facebook'];
export const LABELS={tiktok:'TikTok',instagram:'Instagram',facebook:'Facebook'};
export const LINKS={tiktok:'https://www.tiktok.com/',instagram:'https://www.instagram.com/',facebook:'https://www.facebook.com/'};
export function groupVideos(videos,campaign){
 const groups=new Map();
 for(const v of videos.filter(v=>v.campaign_id===campaign)){
  const key=/^sf-[a-f0-9-]+-(tiktok|instagram|facebook)$/.test(v.id)?v.id.replace(/-(tiktok|instagram|facebook)$/,''):v.id;
  if(!groups.has(key))groups.set(key,{key,records:[]});groups.get(key).records.push(v);
 }return [...groups.values()];
}
export function videoFields(v){const {id,baseline,kind,created_at,updated_at,...data}=v;return data;}
export function captionOf(v){return [v.caption.trim(),v.hashtags.trim()].filter(Boolean).join('\n\n');}
export function pendingFor(groups,platform){return groups.flatMap(g=>g.records.filter(v=>v.platform===platform&&v.status!=='posted'));}
export function validPostUrl(value,platform){try{const u=new URL(value),root={tiktok:'tiktok.com',instagram:'instagram.com',facebook:'facebook.com'}[platform];return u.protocol==='https:'&&(u.hostname===root||u.hostname.endsWith('.'+root))&&u.pathname!=='/';}catch{return false;}}

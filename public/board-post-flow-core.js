export const FLOW_LIMIT=20;
export const FLOW_HEADER=48, FLOW_ROW=280, FLOW_NEXT=58;
export const flowHeight=rows=>FLOW_HEADER+Math.max(1,rows.length)*FLOW_ROW+(rows.length&&rows.length<FLOW_LIMIT?FLOW_NEXT:0);
export function putFlowVideo(rows,mediaId,title='',index=rows.length){
 if(!Array.isArray(rows)||index<0||index>rows.length||!Number.isInteger(index))throw Error('Choose a video slot.');
 if(index===rows.length&&rows.length>=FLOW_LIMIT)throw Error('This flow holds up to 20 videos.');
 if(typeof mediaId!=='string'||!/^med-[a-z0-9]{6,16}$/.test(mediaId))throw Error('Choose a saved video.');
 const next=structuredClone(rows);
 next[index]={...(next[index]||{caption:'',hashtags:'',platform:'tiktok'}),media_id:mediaId,title:String(title).slice(0,80)};
 return next;
}
export function flowDropIndex(item,point){
 const rows=item.flow_rows||[],x=point.x-item.x,y=point.y-item.y-FLOW_HEADER;
 if(item.kind!=='tool'||item.tool_id!=='social-post-flow'||x<8||x>236||y<0)return -1;
 const index=Math.floor(y/FLOW_ROW);
 if(index<rows.length&&y%FLOW_ROW< FLOW_ROW-12)return index;
 if(index===rows.length&&rows.length<FLOW_LIMIT&&y<rows.length*FLOW_ROW+(rows.length?FLOW_NEXT:FLOW_ROW))return index;
 return -1;
}

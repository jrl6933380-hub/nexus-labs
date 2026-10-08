export const LIFE_FEELINGS=['Excited','Calm','Inspired','Hopeful','Proud','Connected','Grateful','Energized','Relieved','Tired','Stressed','Sad','Overwhelmed'];
export const PHOTO_LIMIT=3;
export const PHOTO_BYTES=200000;

// Week boundaries are local; overnight activities contribute only their overlap.
export function journalWeek(items,day){
  const from=new Date(day);from.setHours(0,0,0,0);from.setDate(from.getDate()-((from.getDay()+6)%7));
  const to=new Date(from);to.setDate(to.getDate()+7);
  const overlap=(start,end)=>Math.max(0,Math.min(+to,Date.parse(end))-Math.max(+from,Date.parse(start)))/3600000 || 0;
  const activities=items.filter(item=>item.kind==='activity' && (overlap(item.starts_at,item.ends_at)>0 || overlap(item.actual_starts_at,item.actual_ends_at)>0));
  const pillars=['work','sleep','social','health','personal'].map(pillar=>{
    const records=activities.filter(item=>item.pillar===pillar),ratings=records.filter(item=>Number.isFinite(item.energy));
    return {pillar,planned:records.reduce((sum,item)=>sum+overlap(item.starts_at,item.ends_at),0),actual:records.filter(item=>item.outcome==='happened').reduce((sum,item)=>sum+overlap(item.actual_starts_at,item.actual_ends_at),0),energy:ratings.length ? ratings.reduce((sum,item)=>sum+item.energy,0)/ratings.length : null,ratings:ratings.length};
  });
  const rated=activities.filter(item=>Number.isFinite(item.energy));
  return {from,to,activities,pillars,rated:rated.length,energy:rated.length ? rated.reduce((sum,item)=>sum+item.energy,0)/rated.length : null,confirmed:activities.filter(item=>item.outcome==='happened').length,unknown:activities.filter(item=>!item.outcome || item.outcome==='unknown').length};
}

export async function prepareLifePhoto(file){
  if(!file.type.startsWith('image/'))throw new Error('Choose a photo.');
  if(file.size>20*1024*1024)throw new Error('Choose a photo smaller than 20 MB.');
  const url=URL.createObjectURL(file);
  try{
    const image=new Image();image.src=url;await image.decode();
    const canvas=document.createElement('canvas'),scale=Math.min(1,1200/image.width,1200/image.height);
    canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
    const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
    for(const quality of [.8,.65,.5,.35]){
      const source=canvas.toDataURL('image/jpeg',quality);
      if(source.length<=PHOTO_BYTES)return {source,caption:''};
    }
    throw new Error('This photo is too detailed to save. Try a smaller photo.');
  }catch(error){if(error.name==='EncodingError')throw new Error('This photo format could not be opened. Try a JPEG or PNG.');throw error;}
  finally{URL.revokeObjectURL(url);}
}

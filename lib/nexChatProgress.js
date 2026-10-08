// Public updates only; never serialize tool inputs, results, or thinking blocks.
export function createChatProgress({save,emit=()=>{},now=Date.now}={}) {
  const updates=[];
  let sequence=0,stage=null,writes=Promise.resolve();
  const snapshot=()=>({updates:[...updates],stage});
  return {
    snapshot,
    record(event){
      if(event?.type==='commentary'){
        const text=String(event.text || '').trim().slice(0,800);
        if(!text || updates.at(-1)?.text===text)return;
        updates.push({id:++sequence,text,createdAt:now()});
        if(updates.length>20)updates.shift();
        emit('commentary',updates.at(-1));
      }else{
        const nextStage={state:event?.state || 'running',label:event?.tool==='reasoning'?'Thinking through your request':'Working on your request'};
        if(stage?.state===nextStage.state && stage?.label===nextStage.label)return;
        stage=nextStage;
        emit('stage',stage);
      }
      const value=snapshot();
      writes=writes.then(()=>save(value)).catch(()=>{});
    },
    flush(){return writes;},
  };
}

export function modelProgressText(content=[]) {
  return content.filter(block=>block.type==='text' && typeof block.text==='string').map(block=>block.text).join('\n').replace(/```[\s\S]*?(?:```|$)/gu,'').trim().slice(0,800);
}

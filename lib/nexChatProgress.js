const PHASE_LABELS = Object.freeze({
  planning: 'Planning the work',
  working: 'Working on your request',
  verifying: 'Checking the result',
  waiting: 'Waiting for your input',
  complete: 'Finishing up',
});

export function progressPhase(event = {}) {
  if (event.phase && PHASE_LABELS[event.phase]) return event.phase;
  if (event.state === 'waiting' || event.state === 'blocked') return 'waiting';
  if (event.state === 'complete' || event.state === 'finished') return 'complete';
  const tool = String(event.tool || '');
  if (/planning|reasoning/iu.test(tool)) return 'planning';
  if (/test|inspect_branch_diff|get_workflow_status|check_deployment|review|verify/iu.test(tool)) return 'verifying';
  if (/ask_user_question/iu.test(tool)) return 'waiting';
  if (/search|read|list|find|tool_search/iu.test(tool)) return 'planning';
  return 'working';
}

export function publicProgressUpdate(event = {}, { id = null, now = Date.now } = {}) {
  const phase = progressPhase(event);
  const text = String(event.text || '').replace(/```[\s\S]*?(?:```|$)/gu, '').trim().slice(0, 800);
  if (!text) return null;
  return Object.freeze({
    ...(id === null ? {} : { id }),
    type: 'update',
    phase,
    status: event.status || (phase === 'waiting' ? 'waiting' : phase === 'complete' ? 'complete' : 'active'),
    text,
    createdAt: now(),
  });
}

// Public updates only; never serialize tool inputs, results, or thinking blocks.
export function createChatProgress({save,emit=()=>{},now=Date.now}={}) {
  const updates=[];
  let sequence=0,stage=null,writes=Promise.resolve();
  const snapshot=()=>({updates:[...updates],stage});
  return {
    snapshot,
    record(event){
      if(event?.type==='commentary'){
        const update=publicProgressUpdate(event,{id:sequence+1,now});
        if(!update || updates.at(-1)?.text===update.text)return;
        sequence++;
        updates.push(update);
        if(updates.length>20)updates.shift();
        emit('commentary',updates.at(-1));
      }else{
        const phase=progressPhase(event);
        const nextStage={type:'stage',phase,state:event?.state || (phase==='waiting'?'waiting':'running'),label:PHASE_LABELS[phase]};
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

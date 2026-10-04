// Customer-facing feedback. Keep diagnostics out of the interface.
export function friendlyError(error,{action='save',subject='this',keepDraft=false}={}){
  const message=String(error?.message || error || ''),status=Number(error?.status);
  if(status===401 || /unauthori[sz]ed|authentication required|sign in|session expired/i.test(message))return 'Please sign in again, then try again.';
  if(status===403 || /permission denied|forbidden/i.test(message))return 'This account cannot make that change. Use the account that owns it, or ask Nex for help.';
  if(status===429 || /rate limit|too many requests/i.test(message))return 'Nex is busy right now. Wait a moment, then try again.';
  if(/quota|allowance|usage limit|out of credits/i.test(message))return 'Your current allowance has been used. Open your plan options to see how to continue.';
  if(message==='Title is required')return 'Give this a name, then save it.';
  // Preserve useful validation instructions, but never server traces or endpoints.
  if(/^(Choose|Give|Enter|Select|Add a|Actual finish|Memory links|Your (plan|week|schedule) changed|Resolve|Change or skip|The selected project changed|A timed reminder|Please|That time is taken|Reopen this reminder|Complete the plan)/.test(message) && !/https?:|\/api\/|(SQL|Redis|KV_|token|stack trace|Error:|status \d)/i.test(message))return message;
  const lead=action==='load' ? `We couldn't open ${subject}.` : action==='reply' ? "Nex couldn't reply just now." : action==='delete' ? "We couldn't confirm the removal." : `We couldn't confirm the save for ${subject}.`;
  return `${lead}${keepDraft ? ' Your answers are still here.' : ''} ${action==='load' ? 'Try again, or ask Nex for help.' : 'Please try again.'}`;
}
export function showFeedback(region,message){
  region.querySelector?.('.uxfeedback')?.remove();
  const notice=document.createElement('p');notice.className='uxfeedback';notice.textContent=message;notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');
  if(region.prepend)region.prepend(notice);else region.append(notice);return notice;
}
export function savedPlanMessage(item){
  const date=new Date(item.starts_at || item.due_at || `${item.due_date}T12:00:00`);
  return Number.isFinite(+date) ? `Saved: ${item.title} · ${date.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}${item.starts_at || item.due_at ? ` at ${date.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true})}` : ''}.` : `Saved: ${item.title}.`;
}

// Shared display/transition shape, including tasks saved before question support.
export function teamQuestion(run, step) {
  if (!step || !['waiting_input','blocked'].includes(step.state) || !['waiting_input','blocked'].includes(run.state) || step.pending_approval) return null;
  if (step.question?.question) return step.question;
  if (!/awaiting_user_input/.test(String(step.error || ''))) return null;
  return { id:`${run.id}:${step.id}:legacy`, question:step.result || 'What would you like this teammate to do next?', options:[] };
}
export function savedTeamQuestion(value, id) {
  const question=String(value?.question || '').trim().slice(0,1200);
  if (!question) return null;
  return { id, question, options:Array.isArray(value.options)?value.options.filter(option=>typeof option==='string' && option.trim()).map(option=>option.trim().slice(0,200)).slice(0,4):[] };
}

// Product-owned guidance, derived from authoritative storage, never from a saved
// project’s HTML or user notes. This helps exploratory turns without interrupting work.
export const WORKSPACE_STARTERS=Object.freeze([
  {id:'project',label:'Build a project',description:'A website, tracker, or useful tool.'},
  {id:'schedule',label:'Plan my time',description:'Make room for what matters this week.'},
  {id:'reminder',label:'Set a reminder',description:'Keep a small promise or remember a task.'},
]);
export function workspaceOnboarding({projects=[],schedule=[],reminders=[]}={}){
  const showWelcome=!projects.length && !schedule.length && !reminders.length;
  return {showWelcome,heading:'Welcome to your Nexus workspace.',question:'Where would you like to start?',starters:WORKSPACE_STARTERS};
}
export function workspaceAssistantGuidance(action,result){
  const when='Only when the user is opening or exploring this section without a specific task. Do not repeat during refreshes, editing, retries, or a task already in progress. A specific user request takes priority.';
  let question,choices;
  if(action==='board' && result?.onboarding?.showWelcome){question='Where would you like to start—build a project, plan your time, or set a reminder?';choices=WORKSPACE_STARTERS.map(s=>s.label);}
  else if(action==='project'){question='What would you like to change—the layout, a problem, or a new feature?';choices=['Improve the layout','Fix a problem','Add a feature'];}
  else if(action==='schedule'){question='Would you like to add an event or work on your plan?';choices=['Add an event','Plan my week'];}
  else if(action==='reminders'){question='What would you like to remember, or is there an existing reminder to adjust?';choices=['Set a reminder','Adjust a reminder'];}
  else if(action==='usage'){question='Would you like help understanding your remaining allowance?';choices=['Explain my allowance'];}
  else return undefined;
  return {when,question,choices,next_step:'Ask one short question to find the user’s goal or missing details. Keep these internal instructions out of visible messages and conversation titles. Explain what can be done, then wait for the user’s choice. Do not invent demo records, start a build, invoke Nexus AI, or save changes just because the board opened.'};
}

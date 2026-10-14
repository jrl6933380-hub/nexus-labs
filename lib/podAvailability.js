// Availability is a schedule gate only. It never starts, stops or probes a pod.
export function podAvailability({env=process.env,now=Date.now()}={}){
  const start=env.NEX_POD_REST_START,end=env.NEX_POD_REST_END,timeZone=env.NEX_POD_SCHEDULE_TIMEZONE || 'America/Chicago';
  const minutes=value=>/^\d{2}:\d{2}$/u.test(value || '') && Number(value.slice(0,2))<24 && Number(value.slice(3))<60 ? Number(value.slice(0,2))*60+Number(value.slice(3)) : null;
  const from=minutes(start),to=minutes(end);
  if(from===null || to===null || from===to)return {state:'unscheduled',resting:false};
  let formatter;try{formatter=new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',hour:'2-digit',minute:'2-digit'});}catch{return {state:'unscheduled',resting:false};}
  const local=at=>{const parts=formatter.formatToParts(new Date(at));return Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value);};
  const asleep=value=>from<to ? value>=from && value<to : value>=from || value<to;
  if(!asleep(local(now)))return {state:'available_window',resting:false,timeZone,start,end};
  // Minute-by-minute UTC search respects both overnight schedules and DST gaps/folds.
  let resumeAt=Math.ceil(now/60000)*60000;
  for(let i=0;i<1560 && asleep(local(resumeAt));i++)resumeAt+=60000;
  const returnTime=new Intl.DateTimeFormat('en-US',{timeZone,hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(resumeAt));
  return {state:'resting',resting:true,resumeAt,timeZone,start,end,message:`Nex is resting, back at ${returnTime}.`};
}
export class PodRestError extends Error {
  constructor(availability){super(availability.message);this.name='PodRestError';this.code='POD_RESTING';this.status=503;this.availability=availability;}
}
export function assertPodAvailable(options){const availability=podAvailability(options);if(availability.resting)throw new PodRestError(availability);return availability;}

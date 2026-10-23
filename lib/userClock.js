import './store/installFetch.js';
// Server time is authoritative. The device supplies only a validated IANA zone.
export function validTimezone(value) {
  if(typeof value!=='string' || value.length>80 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)*$/u.test(value))return null;
  try{return new Intl.DateTimeFormat('en-US',{timeZone:value}).resolvedOptions().timeZone;}catch{return null;}
}
const parts=(date,timeZone)=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
const localStamp=p=>`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
export function currentUserClock(timezone,{now=Date.now}={}) {
  const zone=validTimezone(timezone),date=new Date(now()),p=parts(date,zone || 'UTC'),today=`${p.year}-${p.month}-${p.day}`;
  const tomorrow=new Date(`${today}T12:00:00Z`);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
  const offset=Math.round((Date.parse(`${localStamp(p)}Z`)-Math.floor(date.getTime()/1000)*1000)/60000);
  const suffix=`${offset>=0?'+':'-'}${String(Math.floor(Math.abs(offset)/60)).padStart(2,'0')}:${String(Math.abs(offset)%60).padStart(2,'0')}`;
  return {utcNow:date.toISOString(),timezone:zone,timezoneKnown:Boolean(zone),localNow:zone?`${localStamp(p)}${suffix}`:null,today,weekday:new Intl.DateTimeFormat('en-US',{timeZone:zone || 'UTC',weekday:'long'}).format(date),tomorrow:tomorrow.toISOString().slice(0,10),tomorrowWeekday:new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'long'}).format(tomorrow)};
}
export function clockDirective(timezone,{scheduleTools=true,...options}={}) {
  const clock=currentUserClock(timezone,options);
  return `LIVE SERVER CLOCK (authoritative; supersedes stale dates in messages and memories)\n${JSON.stringify(clock)}\nResolve today, tomorrow, weekdays, and next week from this clock in the user's timezone. Recheck get_current_time before scheduling during a long task. If timezoneKnown is false, the displayed dates are UTC references only: ask the user's timezone before assigning local times. Never infer their timezone from UTC storage. UTC storage is not the user's local time. Use explicit timezone offsets when saving times; verify the saved local date and weekday in your reply.${scheduleTools ? ' To correct an existing schedule, read it and call update_planner_item with its existing ID; do not create duplicates. To clear explicitly requested blocks, read the matching range, identify the items, and use delete_planner_item for those IDs only. When your scope grants schedule access, mutation tools are in tool_search category planner; load them before claiming you cannot edit or delete. Reminders have manage_reminder update/delete; Life has manage_life preview/save/delete.' : ''} Respect the active account, scope, and approvals.`;
}
export function localTimeToIso(value,timezone) {
  if(typeof value!=='string')throw new Error('A schedule time must be a date/time string.');
  if(/(?:Z|[+-]\d{2}:\d{2})$/iu.test(value)){
    const stamp=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/iu.exec(value);
    const calendar=stamp && `${stamp[1]}T${stamp[2]}:${stamp[3]}:${stamp[4] || '00'}`;
    const reference=calendar && Date.parse(`${calendar}Z`);
    if(!Number.isFinite(Date.parse(value)) || !Number.isFinite(reference) || new Date(reference).toISOString().slice(0,19)!==calendar)throw new Error('Invalid schedule date/time.');
    return new Date(value).toISOString();
  }
  const zone=validTimezone(timezone);
  if(!zone)throw new Error('User timezone is unknown. Ask for it before saving a local time.');
  const match=/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/u.exec(value);
  if(!match)throw new Error('Use a valid ISO date/time with an explicit offset.');
  const desired=`${match[1]}T${match[2] || '00'}:${match[3] || '00'}:${match[4] || '00'}`,anchor=Date.parse(`${desired}Z`);
  if(!Number.isFinite(anchor) || new Date(anchor).toISOString().slice(0,19)!==desired)throw new Error('Invalid local date/time.');
  const offsets=new Set();
  for(let hours=-36;hours<=36;hours+=6){const t=anchor+hours*3600000;offsets.add(Date.parse(`${localStamp(parts(new Date(t),zone))}Z`)-t);}
  const candidates=[...offsets].map(offset=>anchor-offset).filter(t=>localStamp(parts(new Date(t),zone))===desired);
  if(candidates.length!==1)throw new Error('This local time is ambiguous or does not exist because of daylight saving time. Ask for an explicit offset or another time.');
  return new Date(candidates[0]).toISOString();
}
export function schedulingInput(input,timezone) {
  const result={...input};
  for(const field of ['starts_at','ends_at','due_at','actual_starts_at','actual_ends_at','day_end','from','to'])if(result[field]!=null && result[field]!=='')result[field]=localTimeToIso(result[field],timezone);
  if(Array.isArray(result.entries))result.entries=result.entries.map(entry=>schedulingInput(entry,timezone));
  const zone=validTimezone(timezone);if(zone && !result.timezone && (result.action==='create' || result.action==='preview' || Object.hasOwn(result,'due_at')))result.timezone=zone;
  return result;
}
async function redis(command) {
  const response=await fetch(process.env.KV_REST_API_URL,{method:'POST',headers:{Authorization:`Bearer ${process.env.KV_REST_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(2000)});
  if(!response.ok)throw new Error('Clock profile unavailable');const data=await response.json();if(data.error)throw new Error('Clock profile unavailable');return data.result;
}
export async function resolveUserTimezone(userId,deviceTimezone,{command=redis,configured=Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)}={}) {
  const zone=validTimezone(deviceTimezone),key=`nexus:user-timezone:v1:${encodeURIComponent(String(userId || '').toLowerCase())}`;
  if(!userId || !configured)return zone;
  try {if(zone){await command(['SET',key,zone]);return zone;}return validTimezone(await command(['GET',key]));}catch{return zone;}
}
export const CLOCK_TOOL={name:'get_current_time',description:'Read the live server clock in the signed-in user’s timezone. Returns current UTC/local date and time, weekday and tomorrow. Use before scheduling after a long task or when earlier messages contain stale dates. No account changes.',input_schema:{type:'object',properties:{}}};

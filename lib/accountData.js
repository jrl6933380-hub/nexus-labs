import { getSafeUser, deleteUser } from './roomAuth.js';
import { listPlannerItems } from './planner.js';
import { reminderStore } from './reminders.js';
import { lifeStore } from './life.js';
import { listBuilds } from './roomHistory.js';

async function redis(command) {
  const url=process.env.KV_REST_API_URL,token=process.env.KV_REST_API_TOKEN;
  if(!url || !token)throw new Error('Account storage is unavailable');
  const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(command)});
  const data=await response.json();if(!response.ok || data.error)throw new Error('Account storage request failed');return data.result;
}

export function createAccountDataService({
  command=redis,
  account=getSafeUser,
  removeAccount=deleteUser,
  schedule={list:listPlannerItems},
  reminders=reminderStore,
  life=lifeStore,
  projects={list:listBuilds},
  now=()=>new Date().toISOString(),
}={}){
  const scoped=username=>`room:${username}`;
  async function exportData(username){
    const profile=await account(username);if(!profile)throw new Error('Account not found');
    const user=scoped(username);
    const [scheduleItems,reminderItems,lifeData,projectItems]=await Promise.all([
      schedule.list({},user),reminders.list(user),life.overview(user),projects.list(username),
    ]);
    return {exportedAt:now(),account:profile,schedule:scheduleItems,reminders:reminderItems,life:lifeData,projects:projectItems};
  }
  async function purgeData(username){
    const user=scoped(username),encodedUser=encodeURIComponent(user),encodedName=encodeURIComponent(username);
    const exact=[
      `nexus:schedule:items:v2:${encodedUser}`,
      `nexus:schedule:migrated:v1:${encodedUser}`,
      `nexus:reminders:v1:${encodedUser}`,
      `nexus:life:v1:${encodedUser}`,
      `nexus:life:v1:${encodedUser}:pulses`,
      `nexus:push:subscriptions:v1:${encodedUser}`,
      `nexus:room:builds:${username}`,
      `nexus:room:builds:${username}:current`,
      `nexus:room:project-credits:${username}`,
      `nexus:room:live-sites:${username}`,
    ];
    const patterns=[
      `nexus:room:conversation:${encodedName}:*`,
      `nexus:room:meter:${encodedName}:*`,
      `nexus:room:reservation-index:${encodedName}:*`,
      `nexus:room:reservation:${encodedName}:*`,
      `nexus:room:daily-meter:${encodedName}:*`,
      `nexus:room:daily-reservation-index:${encodedName}:*`,
      `nexus:room:daily-reservation:${encodedName}:*`,
      `nexus:push:sent:v1:${encodedUser}:*`,
    ];
    const discovered=[];
    for(const pattern of patterns){const keys=await command(['KEYS',pattern]);if(Array.isArray(keys))discovered.push(...keys);}
    const keys=[...new Set([...exact,...discovered])];
    for(const key of keys)await command(['DEL',key]);
    await command(['SREM','nexus:push:users:v1',user]);
    const deleted=await removeAccount(username);
    return {...deleted,dataKeysRemoved:keys.length};
  }
  return {exportData,purgeData};
}

export const accountDataService=createAccountDataService();

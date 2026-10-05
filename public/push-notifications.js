import {isIosDevice,isStandalone} from './app-install.js';

function bytes(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/gu, '+').replace(/_/gu, '/');
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

export function notificationError(error){
  if(error?.code==='worker-timeout'||error?.code==='worker-unavailable')return 'Your phone could not start notifications. Close Nexus, reopen it from your Home Screen, then try again.';
  if(error?.code==='network-timeout')return 'The notification setup check took too long. Check your connection, then tap Try again.';
  if(error?.status===401)return 'Please sign in again, then return here to enable notifications.';
  if(error?.name==='NotAllowedError')return 'Notifications are blocked for Nexus. Check your phone notification settings, then try again.';
  if(error?.code==='permission-denied')return 'Notifications are off. Allow Nexus in your phone notification settings, then try again.';
  return 'Notifications could not be set up. Please try again.';
}
function setupError(message,code){return Object.assign(new Error(message),{code});}
export function boundedSetup(promise,timeoutMs,code){
  let timer;return Promise.race([promise,new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(setupError('Notification setup timed out',code)),timeoutMs);})]).finally(()=>clearTimeout(timer));
}
export async function notificationRegistration(serviceWorker=globalThis.navigator?.serviceWorker,timeoutMs=10000){
  if(!serviceWorker)throw setupError('Notification service unavailable','worker-unavailable');
  try{
    const registration=await boundedSetup(serviceWorker.getRegistration('/'),timeoutMs,'worker-timeout');
    if(registration?.active)return registration;
    await boundedSetup(serviceWorker.register('/service-worker.js',{scope:'/'}),timeoutMs,'worker-timeout');
    return await boundedSetup(serviceWorker.ready,timeoutMs,'worker-timeout');
  }catch(error){if(error?.code)throw error;throw setupError('Notification service unavailable','worker-unavailable');}
}

async function api(action,input={}) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),10000);
  try{
  const response=await fetch('/api/push',{signal:controller.signal,credentials:'include',...(action?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...input})}:{})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error('Notifications could not be updated'),{status:response.status});
  return data;
  }catch(error){if(error?.name==='AbortError')throw setupError('Notification request timed out','network-timeout');throw error;}finally{clearTimeout(timer);}
}

export function pushSupport({windowObject=globalThis.window,navigatorObject=globalThis.navigator}={}){
  if(!windowObject?.isSecureContext)return 'insecure';
  if(isIosDevice(navigatorObject)&&!isStandalone(windowObject,navigatorObject))return 'install-required';
  if(!('Notification' in windowObject)||!navigatorObject?.serviceWorker||!('PushManager' in windowObject))return 'unsupported';
  return 'supported';
}

export async function notificationState(){
  const support=pushSupport();
  if(support!=='supported')return {support,permission:'unavailable',configured:false,enabled:false};
  const server=await api();
  const registration=await notificationRegistration();
  const subscription=await boundedSetup(registration.pushManager.getSubscription(),10000,'worker-timeout');
  return {...server,support,permission:Notification.permission,enabled:Boolean(subscription)};
}

export async function enableNotifications(){
  if(pushSupport()!=='supported')throw new Error('Open Nexus from your Home Screen to turn on notifications.');
  // Request permission while the tap still grants browser user activation.
  const permission=await Notification.requestPermission();
  if(permission!=='granted')throw setupError('Notifications are off','permission-denied');
  const server=await api();
  if(!server.configured||!server.publicKey)throw new Error('Phone notifications are being prepared. Try again shortly.');
  const registration=await notificationRegistration();
  let subscription=await boundedSetup(registration.pushManager.getSubscription(),10000,'worker-timeout');
  if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(server.publicKey)});
  await api('subscribe',{subscription:subscription.toJSON()});
  await api('test');
  return {enabled:true};
}

export async function disableNotifications(){
  const registration=await notificationRegistration();
  const subscription=await boundedSetup(registration.pushManager.getSubscription(),10000,'worker-timeout');
  if(subscription){await api('unsubscribe',{endpoint:subscription.endpoint});await subscription.unsubscribe();}
  return {enabled:false};
}

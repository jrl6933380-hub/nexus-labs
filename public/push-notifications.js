function bytes(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/gu, '+').replace(/_/gu, '/');
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

async function api(action,input={}) {
  const response=await fetch('/api/push',{credentials:'include',...(action?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...input})}:{})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error || 'Notifications could not be updated');
  return data;
}

export function pushSupport({windowObject=globalThis.window,navigatorObject=globalThis.navigator}={}){
  if(!windowObject?.isSecureContext)return 'insecure';
  if(!('Notification' in windowObject)||!navigatorObject?.serviceWorker||!('PushManager' in windowObject))return 'unsupported';
  return 'supported';
}

export async function notificationState(){
  const support=pushSupport();
  if(support!=='supported')return {support,permission:'unavailable',configured:false,enabled:false};
  const server=await api();
  const registration=await navigator.serviceWorker.ready;
  const subscription=await registration.pushManager.getSubscription();
  return {...server,support,permission:Notification.permission,enabled:Boolean(subscription)};
}

export async function enableNotifications(){
  const server=await api();
  if(!server.configured||!server.publicKey)throw new Error('Phone notifications are being prepared. Try again shortly.');
  const permission=await Notification.requestPermission();
  if(permission!=='granted')throw new Error('Notifications are off. Allow them in your phone settings, then try again.');
  const registration=await navigator.serviceWorker.ready;
  let subscription=await registration.pushManager.getSubscription();
  if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(server.publicKey)});
  await api('subscribe',{subscription:subscription.toJSON()});
  await api('test');
  return {enabled:true};
}

export async function disableNotifications(){
  const registration=await navigator.serviceWorker.ready;
  const subscription=await registration.pushManager.getSubscription();
  if(subscription){await api('unsubscribe',{endpoint:subscription.endpoint});await subscription.unsubscribe();}
  return {enabled:false};
}

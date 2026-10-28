// Owner phone setup lives in the main Nexus shell. No device secret is kept here.
const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const button=(label,run)=>{const b=node('button',label);b.type='button';b.onclick=run;return b;};
export const PHONE_COMPANION_VERSION='0.2';
export const PHONE_APP_INTENT='intent://connect#Intent;scheme=nexusphone;package=app.nexus.phone;S.browser_fallback_url=https%3A%2F%2Fnexus-labs-sigma.vercel.app%2Fphone.html%3Finstall%3D1;end';
export async function renderNexusPhone(ctx){
 let expiryTimer;const root=node('section');root.className='nexusphone';
 const style=node('style');style.textContent='.nexusphone{max-width:720px;margin:auto;padding:12px 0 32px}.nexusphone p{line-height:1.6}.nexusphone .phoneactions{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}.nexusphone button,.nexusphone a{font:inherit;min-height:44px;box-sizing:border-box}.nexusphone button,.nexusphone a.phonebutton{padding:12px 16px;border:1px solid currentColor;border-radius:8px;background:transparent;color:inherit;text-decoration:none;display:inline-flex;align-items:center;cursor:pointer}.nexusphone button:disabled{opacity:.55;cursor:default}.nexusphone button:focus-visible,.nexusphone a:focus-visible{outline:3px solid currentColor;outline-offset:3px}.nexusphone code{font-size:clamp(18px,4vw,26px);overflow-wrap:anywhere;user-select:all}.nexusphone .phonestep{border-top:1px solid currentColor;padding:14px 0}.nexusphone h2{font-size:21px}.nexusphone .phonefeedback{font-weight:600}';root.append(style);
 root.append(button('← Nexus Home',()=>ctx.openOwnerHome?ctx.openOwnerHome():ctx.go('messages')),node('h1','Phone'));
 if(ctx.customer){root.append(node('p','Phone controls are available only in the Nexus owner workspace.'));return root;}
 root.append(node('p','Pair your TCL and open the companion app from here. You create the code in Nexus; you paste it into the installed Android app.'));
 const status=node('p','Checking phone connection…');status.setAttribute('role','status');root.append(status);
 const feedback=node('p');feedback.className='phonefeedback';feedback.setAttribute('role','status');root.append(feedback);
 const signIn=node('a','Sign in to Nexus as owner');signIn.href='/nexus-login.html?next=%2Fworkspace.html%3Fview%3Dphone';signIn.hidden=true;root.append(signIn);
 async function api(action){const r=await fetch('/api/phone',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify({action})});const d=await r.json();if(!r.ok)throw Error(d.error||'Phone connection unavailable.');return d;}
 const first=node('section');first.className='phonestep';first.append(node('h2','1. Install or update Nexus Phone'));
 first.append(node('p','Version 0.2 adds the Open phone app shortcut and puts the pairing field near the top. Install this update over version 0.1; you do not need to uninstall it.'));
 const download=node('a','Download / update Android app · v0.2');download.className='phonebutton';download.href='/downloads/nexus-phone-0.2.apk';download.download='nexus-phone-0.2.apk';first.append(download);root.append(first);
 const second=node('section');second.className='phonestep';second.append(node('h2','2. Create and copy your pairing code'));
 const codeBox=node('div'),code=node('code'),expires=node('p');codeBox.hidden=true;codeBox.append(code,expires);
 const copy=button('Copy code',async()=>{try{await navigator.clipboard.writeText(code.textContent);feedback.textContent='Code copied. Tap Open phone app and paste it into the field labeled Pairing code.';}catch{feedback.textContent='Press and hold the code to copy it.';}});codeBox.append(copy);
 const generate=button('Create pairing code',async()=>{generate.disabled=true;try{const p=await api('pair_code');code.textContent=p.code.match(/.{1,6}/g).join('-');expires.textContent='Private code · expires '+new Date(p.expires_at).toLocaleTimeString();codeBox.hidden=false;feedback.textContent='Copy this code, then open the phone app below.';clearTimeout(expiryTimer);expiryTimer=setTimeout(()=>{codeBox.hidden=true;code.textContent='';},Math.max(0,p.expires_at-Date.now()));expiryTimer.unref?.();}catch(e){feedback.textContent=e.message;}finally{generate.disabled=false;}});second.append(generate,codeBox);root.append(second);
 const third=node('section');third.className='phonestep';third.append(node('h2','3. Open the installed phone app'));
 const open=node('a','Open phone app');open.className='phonebutton';open.href=PHONE_APP_INTENT;
 if(/Android/i.test(navigator.userAgent))third.append(open);else third.append(node('p','Open this Phone workspace on your TCL to use the app shortcut. Your iPhone can still check status and stop the session.'));
 third.append(node('p','In Nexus Phone, paste your code under Pairing code and tap Pair this TCL. Then enable Nexus Phone accessibility and tap Connect. The native app is required to control the device; this web page cannot grant Android permissions.'));root.append(third);
 const controls=node('div');controls.className='phoneactions';
 async function refresh(){try{const s=await api('status');status.textContent=s.paired?`${s.label||'Phone'} · ${s.active?'Connected':'Disconnected'} · Accessibility ${s.accessibility?'ready':'not enabled'}`:'No phone paired yet.';signIn.hidden=true;generate.disabled=false;}catch(e){status.textContent=e.message;generate.disabled=true;signIn.hidden=false;codeBox.hidden=true;code.textContent='';}}
 controls.append(button('Refresh status',refresh),button('Disconnect phone',async()=>{try{await api('stop');feedback.textContent='Phone session stopped.';await refresh();}catch(e){feedback.textContent=e.message;}}));root.append(controls);
 const guide=node('a','Open full phone setup page');guide.href='/phone.html';root.append(guide);
 await refresh();return root;
}

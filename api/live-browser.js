import '../lib/store/installFetch.js';
import {resolveWorkspaceAccount} from '../lib/workspaceConnector.js';
import {liveBrowser} from '../lib/liveBrowser.js';
import {accountLoginStore,LOGIN_PLATFORMS} from '../lib/accountLogins.js';
// Browser endpoint for the live browser panel (/live-browser.html). Owner only; same origin and cookie rules as /api/tiktok-plans.
// The panel can watch, tap, type and approve a saved sign-in. No response ever contains a password.
const ACTIONS=new Set(['frame','open','click','type','press','scroll','approve_login','close']);
const NUMBER=v=>typeof v==='number'&&Number.isFinite(v);
export function createLiveBrowserHandler({resolveAccount=resolveWorkspaceAccount,browser=liveBrowser,logins=accountLoginStore}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
  try{
   const origin=req.headers?.origin,host=req.headers?.host;
   if(origin && new URL(origin).host!==host)return res.status(403).json({error:'Open the browser panel on this Nexus site.'});
   if(req.headers?.['sec-fetch-site']==='cross-site')return res.status(403).json({error:'Cross-site requests are not allowed.'});
   if(!String(req.headers?.['content-type']||'').startsWith('application/json'))return res.status(415).json({error:'Use application/json.'});
   const account=await resolveAccount(req);
   if(account.owner!==true)return res.status(403).json({error:'The live browser is only available to the Nexus owner.'});
   const body=req.body;
   if(!body||typeof body!=='object'||Array.isArray(body))return res.status(400).json({error:'Provide a JSON object.'});
   const {action,...input}=body;
   if(!ACTIONS.has(action))return res.status(400).json({error:'Unknown browser action.'});
   const allowed={frame:[],open:['url'],click:['x','y'],type:['text'],press:['key'],scroll:['dy'],approve_login:['platform'],close:[]}[action];
   if(Object.keys(input).some(k=>!allowed.includes(k)))return res.status(400).json({error:'Unsupported field for this action.'});
   const user=account.id;
   const frame=async()=>{
    const [status,last,saved]=await Promise.all([browser.status(user),browser.lastShot(user),logins.status(user)]);
    return {...status,shot:last?.shot||null,shot_at:last?.at||null,shot_by:last?.by||null,logins:saved.logins.map(l=>({platform:l.platform,username:l.username,has_password:l.has_password}))};
   };
   const slim=r=>({ok:true,url:r.url,title:r.title,shot:r.shot||null});
   let data;
   if(action==='frame')data=await frame();
   else if(action==='open'){if(typeof input.url!=='string')return res.status(400).json({error:'Give a web address.'});data=slim(await browser.act(user,{action:'open',url:input.url},{by:'owner'}));}
   else if(action==='click'){if(!NUMBER(input.x)||!NUMBER(input.y)||input.x<0||input.x>1280||input.y<0||input.y>720)return res.status(400).json({error:'Tap inside the page.'});data=slim(await browser.act(user,{action:'click',x:input.x,y:input.y},{by:'owner'}));}
   else if(action==='type'){if(typeof input.text!=='string'||!input.text||input.text.length>2000)return res.status(400).json({error:'Type 1 to 2000 characters.'});data=slim(await browser.act(user,{action:'type',text:input.text},{by:'owner'}));}
   else if(action==='press'){if(typeof input.key!=='string'||!/^[A-Za-z0-9+_-]{1,40}$/.test(input.key))return res.status(400).json({error:'Choose a key.'});data=slim(await browser.act(user,{action:'press',key:input.key},{by:'owner'}));}
   else if(action==='scroll'){const dy=input.dy===undefined?600:input.dy;if(!NUMBER(dy)||Math.abs(dy)>3000)return res.status(400).json({error:'Scroll between -3000 and 3000.'});data=slim(await browser.act(user,{action:'scroll',dy},{by:'owner'}));}
   else if(action==='approve_login'){if(!LOGIN_PLATFORMS.includes(input.platform))return res.status(400).json({error:'Choose tiktok, instagram or facebook.'});data={...await browser.approveLogin(user,{platform:input.platform})};}
   else data=await browser.close(user);
   return res.status(200).json(data);
  }catch(error){
   const status=Number.isInteger(error?.status)&&error.status>=400&&error.status<600?error.status:503;
   return res.status(status).json({error:status<500||error.code?String(error.message||'The live browser could not do that.'):'The live browser is unavailable. Try again in a moment.',code:error?.code||'BROWSER_UNAVAILABLE'});
  }
 };
}
export default createLiveBrowserHandler();

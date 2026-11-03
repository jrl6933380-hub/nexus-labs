import '../lib/store/installFetch.js';
import {resolveWorkspaceAccount} from '../lib/workspaceConnector.js';
import {allyBridge} from '../lib/allyBridge.js';
import {allyAdReviewQueue} from '../lib/allyAdReviewQueue.js';

export const config={api:{bodyParser:{sizeLimit:'210kb'}}};
const error=(message,status)=>Object.assign(new Error(message),{status});
function sameOrigin(req){
  const origin=req.headers?.origin,host=req.headers?.host;
  if(!origin)return true;
  try{return Boolean(host&&new URL(origin).host===host);}catch{return false;}
}
export function createAllyAdReviewHandler({queue=allyAdReviewQueue,bridge=allyBridge,resolveAccount=resolveWorkspaceAccount}={}){
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    try{
      if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Use GET or POST.'});
      if(!sameOrigin(req))return res.status(403).json({error:'Cross-site request refused.'});
      if(req.method==='GET'){
        const account=await resolveAccount(req);
        if(account?.owner!==true)return res.status(403).json({error:'Owner only.'});
        if(req.query?.action==='video'){
          const part=await queue.videoRange(account.id,req.query.id,req.headers?.range);
          res.setHeader('Content-Type','video/mp4');
          res.setHeader('Accept-Ranges','bytes');
          res.setHeader('Content-Disposition','inline; filename="nexus-qwen-review.mp4"');
          res.setHeader('Content-Length',String(part.data.length));
          res.setHeader('ETag','"'+part.sha256+'"');
          if(part.partial)res.setHeader('Content-Range','bytes '+part.start+'-'+part.end+'/'+part.total);
          return res.status(part.partial?206:200).end(part.data);
        }
        if(req.query?.action&&req.query.action!=='list')throw error('Unsupported action.',400);
        return res.status(200).json({reviews:await queue.list(account.id)});
      }
      if(!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))return res.status(415).json({error:'JSON required.'});
      const body=req.body||{},action=body.action;
      if(typeof body!=='object'||Array.isArray(body)||Buffer.byteLength(JSON.stringify(body))>205000)throw error('Upload part too large.',413);
      const deviceActions=['upload_begin','upload_part','upload_finish'];
      if(deviceActions.includes(action)){
        const auth=String(req.headers?.authorization||'').replace(/^Bearer /,'');
        const {owner,device_id}=await bridge.authorizeActiveDevice(auth);
        if(action==='upload_begin')return res.status(200).json(await queue.begin(owner,device_id,body.input));
        if(action==='upload_part')return res.status(200).json(await queue.part(owner,device_id,body.input));
        return res.status(200).json({review:await queue.finish(owner,device_id,body.input?.id)});
      }
      const account=await resolveAccount(req);
      if(account?.owner!==true)return res.status(403).json({error:'Owner only.'});
      if(!req.headers?.origin)throw error('Open the review page to approve ads.',403);
      if(action==='decide'){
        if(!body.input||typeof body.input!=='object'||Array.isArray(body.input))throw error('Invalid decision.',400);
        return res.status(200).json({review:await queue.decide(account.id,body.input.id,body.input.decision,body.input.review_note)});
      }
      throw error('Unsupported action.',400);
    }catch(e){return res.status(e.status||503).json({error:e.status?e.message:'Review queue temporarily unavailable.'});}
  };
}
export default createAllyAdReviewHandler();

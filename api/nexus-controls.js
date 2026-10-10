import {getRequestUser} from '../lib/roomAuth.js';
import {nexusUsage} from '../lib/nexusUsage.js';
import {getNexusOwner} from '../lib/nexusOwnerAuth.js';
import {nexusControlsStore,validateControls} from '../lib/nexusControls.js';
export function createNexusControlsHandler({getOwner=getNexusOwner,getUser=getRequestUser,meter=nexusUsage,store=nexusControlsStore}={}){
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
    const owner=await getOwner(req).catch(()=>null);
    const user=owner?.id || await getUser(req).catch(()=>null);
    if(!user)return res.status(401).json({error:'Sign in to Nexus first'});
    try{
      if(req.method==='POST'){
        let patch;try{patch=validateControls(req.body);}catch{return res.status(400).json({error:'Choose valid account controls'});}
        return res.status(200).json({preferences:await store.save(user,patch)});
      }
      const [preferences,usage]=await Promise.all([store.preferences(user),store.usage(user)]);
      const usageLimits=await meter.summary(user,{exempt:Boolean(owner)});
      return res.status(200).json({account:{id:user,plan:owner?'Owner':usageLimits.plan,exempt:Boolean(owner)},preferences,usage,usageLimits});
    }catch(error){console.error('Nexus controls:',error.message);return res.status(503).json({error:'Account controls are temporarily unavailable. Try again.'});}
  };
}
export default createNexusControlsHandler();

import {timingSafeEqual} from 'node:crypto';
import {nexusLabJobs} from '../lib/nexusLabJobs.js';
import {nexusLabService} from '../lib/nexusLabRuntime.js';
import {sweepLabJobs} from '../lib/nexusLabWorker.js';
export function createLabSweepHandler({secret=()=>process.env.CRON_SECRET,store=nexusLabJobs,service=nexusLabService,sweep=sweepLabJobs}={}){return async(req,res)=>{
 res.setHeader('Cache-Control','no-store');if(req.method!=='GET')return res.status(405).json({error:'Use GET.'});
 const expected=secret(),want=Buffer.from('Bearer '+(expected||'')),given=Buffer.from(String(req.headers?.authorization||''));
 if(!expected||want.length!==given.length||!timingSafeEqual(want,given))return res.status(401).json({error:'Unauthorized.'});
 try{return res.status(200).json(await sweep({store,service,maxJobs:2}));}catch{console.error('lab_sweep_failed');return res.status(503).json({error:'Lab recovery will try again on the next sweep.'});}
};}
export default createLabSweepHandler();

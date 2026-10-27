// Trusted operator process; uses the same existing database credentials as other Nexus workers.
import {nexusLabJobs as store} from '../lib/nexusLabJobs.js';
import {nexusLabService as service} from '../lib/nexusLabRuntime.js';
import {sweepLabJobs} from '../lib/nexusLabWorker.js';
const result=await sweepLabJobs({store,service,maxJobs:2});console.log(JSON.stringify(result));

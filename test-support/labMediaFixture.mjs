import {createHash} from 'node:crypto';
import {createAdMediaStore,MEDIA_LIMITS} from '../lib/adMedia.js';
import {createNexusLabAssets} from '../lib/nexusLabAssets.js';
import {createNexusLabJobs} from '../lib/nexusLabJobs.js';
import {labJobMemory} from './labJobMemory.mjs';
export const fixtureOwner={id:'justin'},fixtureOther={id:'another-owner'};
export const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
export const MP4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(32)]);
export function labMediaFixture(){
 const command=labJobMemory();let n=0,time=1000;
 const now=()=>time,media=createAdMediaStore({command,now,newId:()=> 'med-'+String(++n).padStart(6,'0')});
 const assets=createNexusLabAssets({media,command,now}),jobs=createNexusLabJobs({command,now});
 const upload=async({bytes=PNG,kind='image',...rest}={})=>{
  const asset=await assets.begin(fixtureOwner,{name:kind==='image'?'fixture.png':'fixture.mp4',kind,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),width:1,height:1,...rest});
  for(let i=0;i<asset.chunks;i++)await assets.putChunk(fixtureOwner,{media_id:asset.media_id,index:i,data_base64:bytes.subarray(i*MEDIA_LIMITS.chunkBytes,(i+1)*MEDIA_LIMITS.chunkBytes).toString('base64')});
  return assets.finish(fixtureOwner,{media_id:asset.media_id});
 };
 return {command,assets,jobs,upload,now,advance:ms=>time+=ms};
}

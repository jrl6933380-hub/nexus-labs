import {PHOTO_LIMIT,prepareLifePhoto} from './life-journal.js';

// A real file input opens the device photo library; no image URL is required.
export function createLifePhotoPicker({count=()=>0,onPhotos,onError=()=>{},onBusy=()=>{},isBusy=()=>false,camera=false}={}){
  const input=document.createElement('input');input.type='file';input.accept='image/*';input.multiple=!camera;input.hidden=true;
  input.setAttribute('aria-label',camera?'Take a photo':'Add from Photos');
  if(camera)input.setAttribute('capture','environment');
  const trigger=document.createElement('button');trigger.type='button';trigger.className='lifeuploadtrigger';trigger.textContent=camera?'Take a photo':'Add from Photos';trigger.setAttribute('aria-label',trigger.textContent);
  const host=document.createElement('div');host.className='lifephotopicker';host.append(input,trigger);let busy=false;
  trigger.onclick=()=>{if(!busy && !isBusy())input.click();};
  input.onchange=async()=>{
    const files=Array.from(input.files || []);if(busy || isBusy() || !files.length)return;
    busy=true;trigger.disabled=true;onBusy(true);
    try{
      if(count()+files.length>PHOTO_LIMIT)throw new Error('Keep up to three photos per activity.');
      const photos=[];for(const file of files)photos.push(await prepareLifePhoto(file));
      await onPhotos(photos);
    }catch(error){onError(error);}
    finally{busy=false;input.value='';trigger.disabled=false;onBusy(false);}
  };
  return host;
}

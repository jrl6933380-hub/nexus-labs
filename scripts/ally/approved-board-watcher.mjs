#!/usr/bin/env node
// Separate owner-approved MP4 -> Downloads -> existing Video to Board macro.
// Never edits the owner's macro, replaces the original MP4, or posts to social media.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,readdir,lstat,copyFile,access,writeFile} from 'node:fs/promises';
import {join,dirname,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {constants} from 'node:fs';
const runFile=promisify(execFile);
const ROOT=join(process.env.LOCALAPPDATA||process.cwd(),'NexusAlly','qwen-terminal');
const ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/;
const REVIEW=/^[a-f0-9]{32}$/;
const TOKEN=/^[a-f0-9-]{36}$/;
const SHA=/^[a-f0-9]{64}$/;
const BOARD_RECEIPT=/^[a-f0-9]{32}$/;
const short=e=>{const s=String(e?.message||e||'Local handoff failed');return /Command failed|Bearer|BoardToken|powershell\.exe/i.test(s)?'Local board command failed; inspect Ally and board':s.replace(/[\x00-\x1f]/g,' ').slice(0,160);};
const valid=x=>Boolean(x&&REVIEW.test(x.id)&&ID.test(x.project_id)&&TOKEN.test(x.token)&&SHA.test(x.sha256)&&
 Number.isSafeInteger(x.bytes)&&x.bytes>=128&&x.bytes<=8*1024*1024&&
 typeof x.title==='string'&&x.title.trim()&&x.title.length<=120&&!/[\x00-\x1f]/.test(x.title));
export const approvedDownloadName=id=>{
 if(!REVIEW.test(id))throw Error('Invalid approved review ID');
 return 'Nexus-Qwen-Approved-'+id+'.mp4';
};
export function parseSavedReceipt(stdout){
 const lines=String(stdout).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 for(const line of lines.reverse()){
  if(!line.startsWith('{'))continue;
  let receipt;try{receipt=JSON.parse(line);}catch{continue;}
  if(receipt.status!=='saved'||!BOARD_RECEIPT.test(receipt.run_id)||receipt.submitted!==true)throw Error('Video to Board did not confirm Saved');
  return receipt.run_id;
 }
 throw Error('Video to Board returned no verified Saved receipt');
}
async function ps(script,action,args=[],runner=runFile){
 const {stdout}=await runner('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Action',action,...args],
  {shell:false,windowsHide:true,timeout:35000,maxBuffer:10000});
 return JSON.parse(String(stdout).replace(/^\uFEFF/,'').trim());
}
async function documents(runner=runFile){
 const {stdout}=await runner('powershell.exe',['-NoProfile','-NonInteractive','-Command','[Environment]::GetFolderPath("MyDocuments")'],
  {shell:false,windowsHide:true,timeout:8000,maxBuffer:1200});
 const value=String(stdout).trim();
 const home=resolve(process.env.USERPROFILE||value);
 if(!value||value.includes('\n')||!resolve(value).toLowerCase().startsWith(home.toLowerCase()))throw Error('Invalid Documents folder');
 return value;
}
async function checkDirectory(dir){
 const st=await lstat(dir);
 if(!st.isDirectory()||st.isSymbolicLink())throw Error('Unsafe directory link');
}
async function digest(file){
 const h=createHash('sha256');
 for await(const part of createReadStream(file))h.update(part);
 return h.digest('hex');
}
export async function findVerifiedVideo(job,ads){
 if(!valid(job))throw Error('Invalid approved video claim');
 await checkDirectory(ads);
 const project=join(ads,job.project_id);
 await checkDirectory(project);
 const exports=join(project,'exports');
 await checkDirectory(exports);
 const folders=(await readdir(exports,{withFileTypes:true})).filter(x=>x.isDirectory()&&!x.isSymbolicLink()).map(x=>x.name).sort().reverse().slice(0,25);
 for(const folder of folders){
  const dir=join(exports,folder);
  await checkDirectory(dir);
  let receipt;
  try{
   const receiptPath=join(dir,'result.json'),rs=await lstat(receiptPath);
   if(!rs.isFile()||rs.isSymbolicLink()||rs.size>12000)continue;
   receipt=JSON.parse((await readFile(receiptPath,'utf8')).replace(/^\uFEFF/,''));
  }catch{continue;}
  if(receipt.status!=='succeeded'||receipt.stage!=='complete'||
    receipt.verified?.h264!==true||receipt.verified?.decoded!==true||receipt.verified?.silent!==true)continue;
  const file=join(dir,'ad-final.mp4');
  try{
   const st=await lstat(file);
   if(!st.isFile()||st.isSymbolicLink()||st.size!==job.bytes)continue;
   if(await digest(file)===job.sha256)return file;
  }catch{}
 }
 throw Error('No verified local MP4 matches the approved video hash');
}
async function pinned(root,scriptDir){
 const manifest=JSON.parse((await readFile(join(root,'installed.json'),'utf8')).replace(/^\uFEFF/,''));
 const version=basename(dirname(dirname(scriptDir)));
 if(!/^[a-f0-9]{40}$/.test(version)||manifest.revision!==version)throw Error('Pinned launcher and Qwen runner versions differ');
 const runnerRoot=resolve(manifest.root);
 if(!runnerRoot.startsWith(resolve(join(root,'versions'))+(process.platform==='win32'?'\\':'/')))throw Error('Unexpected pinned runner path');
 const macro=join(await documents(),'NexusMacros','VideoToBoard','Video-To-Board.ps1');
 const st=await lstat(macro);
 if(!st.isFile()||st.isSymbolicLink()||st.size<2000||st.size>30000)throw Error('Manual Video to Board macro unavailable');
 return macro;
}
export async function deliver(job,{root=ROOT,scriptDir=dirname(fileURLToPath(import.meta.url)),runner=runFile}={}){
 if(!valid(job))throw Error('Invalid approved video claim');
 const macro=await pinned(root,scriptDir);
 const docs=await documents(runner);
 const src=await findVerifiedVideo(job,join(docs,'NexusAds'));
 const download=join(process.env.USERPROFILE||dirname(docs),'Downloads');
 await checkDirectory(download);
 const dest=join(download,approvedDownloadName(job.id));
 try{await copyFile(src,dest,constants.COPYFILE_EXCL);}
 catch(e){if(e.code!=='EEXIST')throw e;}
 const st=await lstat(dest);
 if(!st.isFile()||st.isSymbolicLink()||st.size!==job.bytes||(await digest(dest))!==job.sha256)throw Error('Downloads MP4 hash mismatch; no board upload');
 const macroDir=dirname(macro);
 // Do not collide with a manual upload or re-run a possibly submitted upload.
 try{await access(join(macroDir,'pending-upload.json'));throw Error('Video to Board has an upload awaiting inspection');}
 catch(e){if(e.code!=='ENOENT')throw e;}
 // This first-generation manual macro opens the board and stops if no Edge board
 // window exists. Prepare that *fixed*, owner-controlled Nexus board beforehand.
 // Sign-in and final Saved status are still validated by the original macro.
 const prepare="$b=Get-Process -Name msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*Nexus Board*' } | Select-Object -First 1; if(-not $b){Start-Process 'https://nexus-labs-sigma.vercel.app/board.html?id=a5eb3e3e438f403185de';Start-Sleep -Seconds 5}";
 await runner('powershell.exe',['-NoProfile','-NonInteractive','-Command',prepare],
  {shell:false,windowsHide:true,timeout:15000,maxBuffer:2000});
 const title=job.title.trim();
 // The original macro has its own named mutex and only reports Saved after board confirmation.
 // -STA is necessary for its Windows file-picker UI automation.
 const {stdout}=await runner('powershell.exe',['-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',
  macro,'-File',dest,'-DisplayName',title],{shell:false,windowsHide:false,timeout:180000,maxBuffer:30000});
 return parseSavedReceipt(stdout);
}
export function startApprovedBoardWatcher({root=ROOT,scriptDir=dirname(fileURLToPath(import.meta.url)),runner=runFile,intervalMs=30000}={}){
 let stopped=false,busy=false;
 const transport=join(scriptDir,'approved-board-transport.ps1');
 const tick=async()=>{
  if(stopped||busy)return;busy=true;let job=null;
  try{
   await pinned(root,scriptDir);
   const data=await ps(transport,'claim',[],runner);
   if(!data?.job)return;
   job=data.job;
   if(!valid(job))throw Error('Invalid private board claim');
   const run=await deliver(job,{root,scriptDir,runner});
   await ps(transport,'complete',['-ReviewId',job.id,'-BoardToken',job.token,'-RunId',run],runner);
  }catch(e){
   // If the original UI macro may have submitted, mark needs_help; NEVER auto-resubmit.
   if(job&&valid(job))await ps(transport,'fail',['-ReviewId',job.id,'-BoardToken',job.token,'-Message',short(e)],runner).catch(()=>{});
   const state=join(root,'approved-board-watcher.json');
   await writeFile(state,JSON.stringify({updated_at:new Date().toISOString(),review_id:job?.id||null,
    status:job?'needs_help':'idle',message:short(e)})).catch(()=>{});
  }finally{busy=false;}
 };
 const timer=setInterval(()=>void tick(),intervalMs);timer.unref?.();
 void tick();
 return {stop(){stopped=true;clearInterval(timer);}};
}

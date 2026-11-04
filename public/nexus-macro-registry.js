// Shared, read-only manifest for verified Nexus macro workflows.
// Each entry is an existing capability, never a claim that a new executor was installed.
// New macros should be registered here only after their underlying action is verified.
export const MACRO_CONTROLLERS=Object.freeze([
 {id:'ads',name:'Make ads',icon:'🎬',description:'Create and prepare ad videos using Qwen on your Ally.',live:true},
 {id:'reviews',name:'Review & fix',icon:'✅',description:'See finished videos, request changes, and approve them.',live:true},
 {id:'boards',name:'Save to boards',icon:'🗂️',description:'Keep finished videos on your Nexus board, without posting to social media.',live:true},
 {id:'research',name:'Research & leads',icon:'🔎',description:'A future home for verified research and business-finding macros.',live:false},
 {id:'devices',name:'Device helpers',icon:'📱',description:'A future home for safe phone and Ally helper macros.',live:false}
]);
const commonAd='Open Nexus Ally Launcher on the Ally, then Qwen Control Console. Run this as a guarded ad task.';
export const VERIFIED_MACROS=Object.freeze([
 {id:'start-ad',controller:'ads',name:'Start a new ad',icon:'✨',summary:'Tell Qwen what you want to advertise. It creates the local ad project.',
  need:'A business, product, or idea and the main message.',result:'A saved ad project on the Ally.',
  simple:[commonAd,'Ask Qwen to start a new ad and give it a short name.','The project stays on the Ally until you decide to make a video.'],
  technical:{tool:'ad_macro',action:'start_ad',arguments:{name:'My New Ad'},source:'Documents/NexusMacros/QwenBridge/Invoke-Macro.ps1'},
  mode:'owner-started',gate:'You start the job. It cannot publish anything.',link:'/ads.html',linkLabel:'Open Ad Maker'},
 {id:'preview-ad',controller:'ads',name:'Preview an ad',icon:'👀',summary:'Check how an ad looks before making the finished video.',
  need:'An ad project that already exists on the Ally.',result:'A preview of that project.',
  simple:[commonAd,'Ask Qwen to preview the existing project.','Look at the preview before rendering the final video.'],
  technical:{tool:'ad_macro',action:'preview_ad',arguments:{project_id:'existing-project-id'},source:'Documents/NexusMacros/QwenBridge/Invoke-Macro.ps1'},
  mode:'owner-started',gate:'No public posting.',link:'/ads.html',linkLabel:'Open Ad Maker'},
 {id:'ad-variations',controller:'ads',name:'Try different versions',icon:'🎨',summary:'Make alternate ideas for an existing ad without losing the original.',
  need:'An existing ad project.',result:'Different ad options you can compare.',
  simple:[commonAd,'Ask Qwen to make variations of the project.','Choose which idea you want to keep.'],
  technical:{tool:'ad_macro',action:'variants_ad',arguments:{project_id:'existing-project-id'},source:'Documents/NexusMacros/QwenBridge/Invoke-Macro.ps1'},
  mode:'owner-started',gate:'Final rendering remains separately gated.',link:'/ads.html',linkLabel:'Open Ad Maker'},
 {id:'package-ad',controller:'ads',name:'Get an ad ready',icon:'📦',summary:'Prepare an existing ad project for the next production step.',
  need:'An existing ad project.',result:'A prepared local ad package.',
  simple:[commonAd,'Ask Qwen to package the ad you chose.','The local project is prepared for rendering.'],
  technical:{tool:'ad_macro',action:'package_ad',arguments:{project_id:'existing-project-id'},source:'Documents/NexusMacros/QwenBridge/Invoke-Macro.ps1'},
  mode:'owner-started',gate:'This is preparation, not publishing.',link:'/ads.html',linkLabel:'Open Ad Maker'},
 {id:'render-ad',controller:'ads',name:'Make the video file',icon:'🎞️',summary:'Turn the ad project into a finished, checked video on the Ally.',
  need:'A prepared ad project.',result:'An MP4 saved inside the project exports folder.',
  simple:[commonAd,'Request the final render. Qwen’s guarded task asks for approval before running it.','The render macro checks the finished MP4.'],
  technical:{tool:'ad_macro',action:'render_ad',arguments:{project_id:'existing-project-id'},source:'Documents/NexusMacros/QwenBridge/Invoke-Macro.ps1'},
  mode:'approval-required',gate:'A guarded Qwen task does not automatically run final rendering.',link:'/ads.html',linkLabel:'Open Ad Maker'},
 {id:'submit-for-review',controller:'reviews',name:'Send video to my phone',icon:'📨',summary:'Send a completed MP4 into your private Qwen Ad Reviews inbox.',
  need:'A verified, finished MP4 on your paired Ally.',result:'A private ad waiting for you to review on your iPhone.',
  simple:['On the Ally, send the completed ad through the existing submit-ad macro.','Open Qwen Ad Reviews on your iPhone.','Only you can approve it or request changes.'],
  technical:{tool:'ad_macro',action:'submit_ad',arguments:{project_id:'existing-project-id'},source:'Documents/NexusMacros/QwenBridge/Invoke-Macro.ps1'},
  mode:'owner-started',gate:'Private review only. No social publishing.',link:'/ally-ad-review.html',linkLabel:'Open Qwen Ad Reviews'},
 {id:'revise-ad',controller:'reviews',name:'Fix an ad I don’t like',icon:'🔁',summary:'Tell Qwen what to change. A new version comes back for your approval.',
  need:'A video awaiting your review and a short note describing the change.',result:'A new, separate video version in your private inbox.',
  simple:['Open Qwen Ad Reviews.','Tap Request changes and say what you want fixed.','The paired Ally runs the automatic revision while Qwen Console is open, and sends the result back for review.'],
  technical:{tool:'owner_review',action:'decide',arguments:{decision:'rejected',review_note:'Shorten the headline'},source:'/api/ally-ad-review and scripts/ally/qwen-revision-watcher.mjs'},
  mode:'approval-required',gate:'New versions always need another owner approval. No publishing.',link:'/ally-ad-review.html',linkLabel:'Review or request changes'},
 {id:'approved-to-board',controller:'boards',name:'Save my approved ad to Nexus',icon:'✅',summary:'After you approve a video, the Ally can copy it to Downloads and put it on your board.',
  need:'An approved Qwen review, the Ally awake, and Nexus Board signed in.',result:'A copy in Downloads and the video saved on Nexus Board.',
  simple:['Approve the video in Qwen Ad Reviews.','For an older approval, tap Send approved video to board.','The Ally checks the MP4, copies it to Downloads, then uses your existing Video to Board macro.','Nexus confirms Saved. Nothing is posted to TikTok.'],
  technical:{tool:'approved_board_watcher',action:'board_claim → Video-To-Board.ps1',arguments:{approval:'owner only'},source:'scripts/ally/approved-board-watcher.mjs'},
  mode:'automatic-after-approval',gate:'Approval is required. Board saving is not public posting.',link:'/ally-ad-review.html',linkLabel:'Open approved ads'},
 {id:'video-to-board',controller:'boards',name:'Put any video on my board',icon:'🖼️',summary:'Use your existing desktop Video to Board shortcut for a video you choose yourself.',
  need:'A video in Downloads and the Nexus board you want.',result:'The selected video saved on that board.',
  simple:['On the Ally, open the Video to Board desktop shortcut.','Pick a video from Downloads and choose the Nexus board.','The macro uploads it and checks for Saved before finishing.','You can still do this manually whenever you want.'],
  technical:{tool:'manual_windows_macro',action:'Video-To-Board.ps1',arguments:{File:'Downloads\\your-video.mp4',BoardUrl:'Nexus board URL',DisplayName:'My video'},source:'Documents/NexusMacros/VideoToBoard/Video-To-Board.ps1'},
  mode:'manual',gate:'Manual uploads do not publish to social media.',link:'/board.html',linkLabel:'Open Nexus Board'}
]);
export const MACRO_MODES=Object.freeze({
 'owner-started':'You start it','approval-required':'Needs your approval',
 'automatic-after-approval':'Runs after approval','manual':'Manual shortcut'
});
export function findMacro(id){return VERIFIED_MACROS.find(m=>m.id===id)||null;}
export function filterMacros({controller='all',search=''}={}){
 const q=String(search).trim().toLocaleLowerCase();
 return VERIFIED_MACROS.filter(m=>(controller==='all'||m.controller===controller)&&
 (!q||[m.name,m.summary,m.need,m.result,...m.simple].join(' ').toLocaleLowerCase().includes(q)));
}
export function reviewSummary(records=[]){
 const rows=Array.isArray(records)?records:[];
 return {
  toReview:rows.filter(r=>r.status==='pending_review').length,
  changesRunning:rows.filter(r=>r.status==='rejected'&&['queued','processing'].includes(r.revision_status)).length,
  boardWorking:rows.filter(r=>r.status==='approved'&&['queued','processing'].includes(r.board_status)).length,
  savedToBoard:rows.filter(r=>r.status==='approved'&&r.board_status==='saved').length,
  needsHelp:rows.filter(r=>(r.revision_status==='needs_help'||r.board_status==='needs_help')).length
 };
}

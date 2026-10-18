import {readFile} from 'node:fs/promises';
// The board page is one inline document with no network, so the shared audio analysis (public/ad-audio.mjs) is pasted
// into it between the AUDIO markers when it is served.
export function inlineBoardAudio(html,source){
  const a=html.indexOf('/*AUDIO-BEGIN*/'),end='/*AUDIO-END*/',b=html.indexOf(end);
  if(a<0||b<a)return html;
  const body=source.replace(/^export /gm,'').replace(/^\/\/.*\n/gm,'').trim();
  return html.slice(0,a)+'/*AUDIO-BEGIN*/\n'+body+'\n'+html.slice(b);
}
export const loadBoardHtml=async()=>inlineBoardAudio(await readFile(new URL('../public/nexus-workspace-board.html',import.meta.url),'utf8'),await readFile(new URL('../public/ad-audio.mjs',import.meta.url),'utf8'));

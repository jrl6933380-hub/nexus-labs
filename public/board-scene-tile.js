import {createSceneRenderer} from './board-scene-render.js?v=20261030-scene1';
export function mountSceneTile(canvas,{request,scene,onError=()=>{}}){
  let renderer=createSceneRenderer(request),current=scene,signature='',time=0,playing=false,disposed=false,last=0,raf,generation=0,chain=Promise.resolve(),visible=!globalThis.IntersectionObserver;
  const draw=()=>{if(disposed||!visible)return;const s=Math.min(1,480/current.width,480/current.height);canvas.width=Math.round(current.width*s);canvas.height=Math.round(current.height*s);renderer.draw(canvas,current,time);};
  function tick(now){if(disposed||!playing||!visible)return;if(now-last>40){time=(time+(now-last)/1000)%current.duration;last=now;draw();}raf=requestAnimationFrame(tick);}
  function load(next){
    const sig=JSON.stringify(next);if(sig===signature)return;signature=sig;canvas.dataset.sceneReady='false';canvas.setAttribute('aria-busy','true');
    const gen=++generation,snapshot=structuredClone(next),active=renderer;
    chain=chain.catch(()=>{}).then(()=>active.load(snapshot)).then(()=>{if(!disposed&&visible&&gen===generation){draw();canvas.dataset.sceneReady='true';canvas.setAttribute('aria-busy','false');}}).catch(e=>{if(!disposed&&gen===generation){canvas.setAttribute('aria-busy','false');onError(e.message);}});
  }
  const observer=globalThis.IntersectionObserver?new IntersectionObserver(entries=>{
    const shown=entries.some(e=>e.isIntersecting);if(shown===visible)return;visible=shown;
    if(visible)load(current);
    else{api.pause();generation++;renderer.dispose();renderer=createSceneRenderer(request);signature='';chain=Promise.resolve();canvas.dataset.sceneReady='false';}
  }):null;
  const api={
    update(next){if(disposed)return;current=next;time=Math.min(time,next.duration);if(visible)load(next);},
    play(){if(disposed||!visible)return;playing=true;last=performance.now();cancelAnimationFrame(raf);raf=requestAnimationFrame(tick);},
    pause(){playing=false;cancelAnimationFrame(raf);},
    seek(value){if(!Number.isFinite(value))return;api.pause();time=Math.max(0,Math.min(current.duration,value));draw();},
    get playing(){return playing;},
    dispose(){disposed=true;generation++;observer?.disconnect();api.pause();renderer.dispose();}
  };if(observer)observer.observe(canvas);else api.update(scene);return api;
}

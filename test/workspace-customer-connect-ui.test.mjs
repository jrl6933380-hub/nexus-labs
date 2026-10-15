import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/workspace-connect.js',import.meta.url),'utf8');
async function harness({signedIn=true,redirect='https://chatgpt.com/connector_platform_oauth_redirect?code=fixture'}={}){
 const nodes=new Map(),calls=[],navigations=[];
 const element=()=>({hidden:false,disabled:false,children:[],append(node){this.children.push(node);},replaceChildren(){this.children=[];}});
 const by=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const context={URL,URLSearchParams,location:{search:'?request=fixture-request',assign:url=>navigations.push(url)},document:{getElementById:by,createElement:element},fetch:async(url,options)=>{calls.push({url,options});return options?.method==='POST'?{ok:true,json:async()=>({redirect_url:redirect})}:{ok:signedIn,status:signedIn?200:401,json:async()=>signedIn?{csrf:'fixture-csrf',client_name:'ChatGPT',callback_origin:'https://chatgpt.com',account:{name:'alice',owner:false},scopes:['workspace:read','workspace:write']}:{error:'Sign in to your Nexus account.'}};}};
 vm.runInNewContext(source,context);await new Promise(resolve=>setImmediate(resolve));return {by,calls,navigations};
}
test('customer sign-in returns to the original pending connection',async()=>{
 const h=await harness({signedIn:false});assert.equal(h.by('signin').hidden,false);assert.equal(h.by('actions').hidden,true);
 const next=new URL(h.by('signin-link').href,'https://nexus.test').searchParams.get('next');assert.equal(next,'/workspace-connect.html?request=fixture-request');
 assert.equal(new URL(h.by('owner-signin-link').href,'https://nexus.test').searchParams.get('mode'),'owner');
});
test('customer approval displays the authenticated account and returns to the verified app',async()=>{
 const h=await harness();assert.equal(h.by('owner').textContent,'Account: alice');assert.equal(h.by('actions').hidden,false);await h.by('allow').onclick();assert.equal(h.navigations.length,1);
 const body=JSON.parse(h.calls.at(-1).options.body);assert.deepEqual(body,{request:'fixture-request',csrf:'fixture-csrf',decision:'allow'});assert.equal(Object.hasOwn(body,'account'),false);
});
test('unexpected callback origins never navigate the customer away',async()=>{
 const h=await harness({redirect:'https://evil.test/callback'});await h.by('allow').onclick();assert.equal(h.navigations.length,0);assert.equal(h.by('allow').disabled,false);assert.match(h.by('status').textContent,/Unexpected return destination/);
});
test('login accepts the local connection return path and rejects foreign destinations',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),start=html.indexOf('  const requested ='),end=html.indexOf('  // Forge Field is',start),snippet=html.slice(start,end);
 for(const [requested,expected] of [['/workspace-connect.html?request=fixture','/workspace-connect.html?request=fixture'],['https://evil.test/workspace-connect.html','/nexus.html'],['//evil.test/workspace-connect.html','/nexus.html'],['/api/private-admin','/nexus.html']]){
  const location={origin:'https://nexus.test',search:'?next='+encodeURIComponent(requested)},context={URL,URLSearchParams,location,window:{location},sessionStorage:{getItem(){return null;}}};vm.runInNewContext(snippet+';result=nextPath;',context);assert.equal(context.result,expected);
 }
});

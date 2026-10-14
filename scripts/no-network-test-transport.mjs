// Test-only guard: unexpected real requests are blocked before leaving the process.
const localFetch=globalThis.fetch;
globalThis.fetch=async(input,options={})=>{
 const url=new URL(typeof input==='string' || input instanceof URL ? input : input.url);
 if(url.protocol!=='http:' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('External requests are disabled in isolated checks. Inject a test transport.');
 // Never follow a local test response to an external provider or callback.
 return localFetch(input,{...options,redirect:'manual'});
};

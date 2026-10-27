// Shared test-only command transport. Each invocation applies atomically before yielding.
export function labJobMemory(){const hashes=new Map(),strings=new Map(),lists=new Map(),sets=new Map();return async([op,key,...a])=>{
 const h=hashes.get(key)||new Map();
 if(op==='HGET')return h.get(a[0])??null;if(op==='HVALS')return [...h.values()];if(op==='HGETALL')return [...h.entries()].flat();if(op==='HEXISTS')return Number(h.has(a[0]));
 if(op==='HSET'||op==='HSETNX'){if(op==='HSETNX'&&h.has(a[0]))return 0;hashes.set(key,h);for(let i=0;i<a.length;i+=2)h.set(a[i],a[i+1]);return 1;}if(op==='HDEL')return Number(h.delete(a[0]));
 if(op==='GET')return strings.get(key)??null;if(op==='SET'){if(a.includes('NX')&&strings.has(key))return null;strings.set(key,a[0]);return 'OK';}if(op==='DEL')return Number(strings.delete(key)||hashes.delete(key));
 if(op==='SADD'){const s=sets.get(key)||new Set();sets.set(key,s);const count=s.size;for(const x of a)s.add(x);return s.size-count;}if(op==='SMEMBERS')return [...(sets.get(key)||[])];
 if(op==='LRANGE')return (lists.get(key)||[]).slice(Number(a[0]),Number(a[1])+1);if(op==='LPUSH'){lists.set(key,[a[0],...(lists.get(key)||[])]);return lists.get(key).length;}if(op==='LTRIM'){lists.set(key,(lists.get(key)||[]).slice(Number(a[0]),Number(a[1])+1));return 'OK';}
 if(op==='EVAL'){if(key.includes("redis.call('HGET'")){const [count,storage,id,old,value]=a,m=hashes.get(storage)||new Map();if(m.get(id)!==old)return 0;m.set(id,value);hashes.set(storage,m);return 1;}const [count,lock,token]=a;if(strings.get(lock)===token)return Number(strings.delete(lock));return 0;}
 throw Error(`Unsupported fixture command ${op}`);
};}

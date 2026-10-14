// Inspect public text and contact links, excluding code and hidden metadata.
export function demoContactDetails(html){
  const source=String(html || '').replace(/<!--[\s\S]*?-->|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/giu,'');
  const decode=value=>value.replace(/&#(?:x([\da-f]+)|(\d+));/giu,(_,hex,decimal)=>String.fromCodePoint(parseInt(hex || decimal,hex?16:10))).replace(/&(?:nbsp|amp|commat);/giu,entity=>({'&nbsp;':' ','&amp;':'&','&commat;':'@'}[entity.toLowerCase()]));
  const text=decode(source.replace(/<[^>]*>/gu,' '));
  const contacts=decode([...source.matchAll(/href\s*=\s*["']((?:tel|mailto):[^"']+)["']/giu)].map(match=>match[1]).join(' '));
  const displayed=text+' '+contacts,found=[];
  if(/\b(?:[\w.+-]+@(?:example\.(?:com|org|net)|yourdomain\.com)|(?:your|demo|sample)[._-]?(?:email|name)@[\w.-]+)\b/iu.test(displayed))found.push('demo email address');
  if(/\b(?:\d{3}[\s.)-]*)?555[\s.-]*(?:01\d{2}|1234|5555)\b/u.test(displayed) || /\b(?:123[\s.-]*456[\s.-]*7890|000[\s.-]*000[\s.-]*0000|123[\s.-]*456[\s.-]*789)\b/u.test(displayed))found.push('placeholder phone number');
  if(/\b(?:your (?:phone number|email address|business address)|123 (?:main|example|sample) (?:st(?:reet)?|road)|demo contact details)\b/iu.test(displayed))found.push('placeholder contact details');
  return found;
}

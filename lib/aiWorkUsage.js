// Internal capacity units, not customer-visible credits or token prices.
// Initial weights must be calibrated against the hourly pod's throughput.
export const AI_WORK_POLICY=Object.freeze({version:1,tokensPerUnit:1000,inputWeight:0.25,cachedInputWeight:0.05,outputWeight:1});
const count=value=>Number.isFinite(value)?Math.max(0,value):0;
export function estimatedInputTokens(messages=[]){
  // Upper-bound text by UTF-8 bytes rather than guessing one token per word.
  // Image inputs reserve a bounded token estimate until the runtime reports usage.
  return messages.reduce((sum,message)=>sum+16+(typeof message.content==='string'?Buffer.byteLength(message.content):Array.isArray(message.content)?message.content.reduce((n,part)=>n+(part.type==='image_url'?4096:Buffer.byteLength(part.text||'')),0):0),0);
}
export function normalizeModelUsage(usage,fallback={}){
 const reportedInput=usage?.prompt_tokens??usage?.input_tokens,reportedOutput=usage?.completion_tokens??usage?.output_tokens;
 const input=Number.isFinite(reportedInput)?reportedInput:fallback.input,output=Number.isFinite(reportedOutput)?reportedOutput:fallback.output;
 const reasoning=count(usage?.completion_tokens_details?.reasoning_tokens??usage?.output_tokens_details?.reasoning_tokens);
 // Completion/output totals already include reasoning. Never add it twice.
 return {input:count(input),output:count(output),cached:Math.min(count(input),count(usage?.prompt_tokens_details?.cached_tokens??usage?.input_tokens_details?.cached_tokens)),reasoning,estimated:!Number.isFinite(reportedInput)||!Number.isFinite(reportedOutput)};
}
export function aiWorkAmount(usage){const p=AI_WORK_POLICY;return Math.max(0.001,Math.ceil(((usage.input-usage.cached)*p.inputWeight+usage.cached*p.cachedInputWeight+usage.output*p.outputWeight)/p.tokensPerUnit*1000)/1000);}
export function usageEstimate(messages,maxOutputTokens){return {input:estimatedInputTokens(messages),output:maxOutputTokens,cached:0};}

export function outputCapacity(available,input){const p=AI_WORK_POLICY;return Math.max(0,Math.floor((available*p.tokensPerUnit-input*p.inputWeight)/p.outputWeight));}

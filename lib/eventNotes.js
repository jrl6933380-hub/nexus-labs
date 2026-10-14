// Generated notes complement structured Calendar fields instead of duplicating them.
export function generatedEventNotes(notes){
  return String(notes || '').split('\n').filter(line=>{
    const value=line.trim();
    if(/^(?:time\s*zone|timezone)\s*:\s*(?:[A-Za-z_]+\/[A-Za-z_/-]+|UTC|GMT|CST|CDT|EST|EDT|MST|MDT|PST|PDT)(?:\s*[([][^\n]*[)\]])?$/iu.test(value))return false;
    return !/^(?:time|starts?|ends?|when)\s*:\s*\d{1,2}:\d{2}(?:\s*[AP]M)?(?:\s*[-–—]\s*\d{1,2}:\d{2}(?:\s*[AP]M)?)?(?:\s*(?:CST|CDT|EST|EDT|MST|MDT|PST|PDT|UTC|GMT))?$/iu.test(value);
  }).join('\n').trim();
}

// Shared by the composer and server: labels never grant access to an agent.
export function teamHandles(members = []) {
  const bases = members.map(member => String(member.name || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/gu, '') || 'agent');
  return members.map((member, index) => ({ ...member, handle: ['team','nex'].includes(bases[index]) || bases.filter(base => base === bases[index]).length > 1 ? `${bases[index]}-${member.id}` : bases[index] }));
}

export function parseTeamMentions(text, members = []) {
  const people = teamHandles(members), mentions = [];
  const pattern = /(^|\s)@(?:"([^"]+)"|([\p{L}\p{N}_-]+))/gu;
  for (const match of String(text).matchAll(pattern)) {
    const value = (match[2] || match[3]).normalize('NFKC').toLowerCase();
    const start = match.index + match[1].length;
    if (['team','nex'].includes(value)) mentions.push({ start, end: start + match[0].trimStart().length, ...(value==='team'?{all:true}:{nex:true}) });
    else {
      const matches = people.filter(person => person.handle === value || String(person.name).normalize('NFKC').toLowerCase() === value);
      if (matches.length !== 1) throw new Error(matches.length ? `Choose a unique @handle for ${value}.` : `Choose an available agent: @${value} is not here.`);
      mentions.push({ start, end: start + match[0].trimStart().length, member_id: matches[0].id });
    }
  }
  return mentions.map((mention, index) => ({ ...mention, instruction: String(text).slice(mention.end, mentions[index + 1]?.start ?? text.length).trim() }));
}

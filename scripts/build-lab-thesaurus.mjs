// Builds lib/data/nexusLabThesaurus.txt from the WordNet 3.x database files (offline, no service).
// Usage: node scripts/build-lab-thesaurus.mjs <path to WordNet dict folder> [output file]
//
// Output: one word per line, tab separated:  word <TAB> close words <TAB> related words
//  - close words: the other words that share the word's most common meaning
//  - related words: words from its next most common meanings, the broader word it is a kind of
//    (sneaker -> shoe), and for adjectives the similar words (peaceful -> calm)
// "Most common" comes from WordNet's own usage counts (index.sense), so "bank" leans to the
// money meaning rather than the river meaning. Only single plain words are kept (no phrases).
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

const dir=process.argv[2];
const out=process.argv[3]||new URL('../lib/data/nexusLabThesaurus.txt',import.meta.url).pathname;
if(!dir){console.error('Pass the WordNet dict folder.');process.exit(1);}
const FILES={1:'noun',2:'verb',3:'adj',4:'adv',5:'adj'};
const POS_FILE={n:'noun',v:'verb',a:'adj',s:'adj',r:'adv'};
const plain=w=>/^[a-z]{3,20}$/.test(w);
const clean=w=>w.toLowerCase().replace(/\(.*\)$/,'');
const MAX_RELATED=14,MAX_CLOSE=14;

const synsets=new Map(); // "noun:00001740" -> {words, up:[ids], similar:[ids]}
for(const name of ['noun','verb','adj','adv']){
  for(const line of readFileSync(join(dir,`data.${name}`),'utf8').split('\n')){
    if(!line||line.startsWith('  '))continue;
    const head=line.split(' | ')[0].split(' ');
    const count=parseInt(head[3],16),words=[];
    for(let i=0;i<count;i++)words.push(clean(head[4+i*2]));
    let at=4+count*2;const pointers=parseInt(head[at++],10),up=[],similar=[];
    for(let i=0;i<pointers;i++){
      const symbol=head[at],target=`${POS_FILE[head[at+2]]}:${head[at+1]}`;at+=4;
      if(symbol==='@'||symbol==='@i')up.push(target);
      else if(symbol==='&')similar.push(target);
    }
    synsets.set(`${name}:${head[0]}`,{words,up,similar});
  }
}
// Every meaning of every word, with how often WordNet's sample text uses it.
const meanings=new Map(); // lemma -> [{id, order, uses}]
for(const line of readFileSync(join(dir,'index.sense'),'utf8').split('\n')){
  if(!line)continue;
  const [key,offset,number,uses]=line.split(' ');
  const [lemma,rest]=key.split('%');if(!plain(lemma))continue;
  const file=FILES[rest.split(':')[0]];
  if(!meanings.has(lemma))meanings.set(lemma,[]);
  meanings.get(lemma).push({id:`${file}:${offset}`,order:['noun','verb','adj','adv'].indexOf(file)*1000+parseInt(number,10),uses:parseInt(uses,10)});
}
const wordsOf=(id,skip)=>(synsets.get(id)?.words||[]).filter(w=>w!==skip&&plain(w));
const rows=[];
for(const [lemma,list] of meanings){
  list.sort((a,b)=>b.uses-a.uses||a.order-b.order);
  const top=list[0],close=new Set(wordsOf(top.id,lemma)),related=new Set();
  for(const meaning of list.slice(1,3))if(meaning.uses>0)for(const w of wordsOf(meaning.id,lemma))related.add(w);
  const set=synsets.get(top.id);
  for(const id of set?.up||[])for(const w of wordsOf(id,lemma))related.add(w);
  for(const id of set?.similar||[])for(const w of wordsOf(id,lemma))related.add(w);
  for(const w of close)related.delete(w);
  if(!close.size&&!related.size)continue;
  rows.push(`${lemma}\t${[...close].sort().slice(0,MAX_CLOSE).join(' ')}\t${[...related].sort().slice(0,MAX_RELATED).join(' ')}`);
}
rows.sort();
writeFileSync(out,rows.join('\n')+'\n');
console.log(`${rows.length} words written to ${out} (${(rows.join('\n').length/1e6).toFixed(2)} MB)`);

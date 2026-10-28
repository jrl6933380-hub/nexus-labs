// Built-in word knowledge for Lab Rank. No model call, no key, no cost.
// A word matches another when they are the same word, share a simple stem
// (shoes/shoe, calming/calm), or sit in the same synonym group below.
export const STOPWORDS = new Set('a an the and or of for to in on at by with from as is are was were be been it its this that these those my your our their we you i me us them he she they so but if then than into onto over under about out up down very just not no'.split(' '));

export const SYNONYM_GROUPS = Object.freeze([
  'calm peaceful serene tranquil relaxing soothing gentle quiet restful mellow',
  'fast quick rapid speedy swift snappy',
  'slow leisurely unhurried',
  'cheap affordable budget inexpensive economical',
  'luxury luxurious premium upscale deluxe',
  'big large huge giant massive oversized',
  'small little tiny compact mini petite',
  'happy joyful cheerful delighted glad upbeat',
  'sad unhappy gloomy somber melancholy',
  'loud noisy booming',
  'exciting thrilling energetic dynamic intense',
  'old senior elderly aged older',
  'young youthful juvenile',
  'kid child youngster',
  'home house residence dwelling',
  'shoe sneaker footwear kick trainer',
  'shirt tee tshirt',
  'car auto automobile vehicle',
  'buy purchase',
  'sale discount deal bargain markdown',
  'free complimentary gratis',
  'new fresh latest',
  'help assist support aid',
  'fix repair mend restore',
  'clean tidy spotless pristine',
  'dog puppy canine pup',
  'cat kitten feline',
  'food meal cuisine dish',
  'doctor physician medic',
  'lawyer attorney counsel',
  'insurance coverage',
  'money cash funds',
  'safe secure protected protective',
  'trust reliable dependable trustworthy',
  'easy simple effortless straightforward',
  'hard difficult tough challenging',
  'beautiful pretty gorgeous stunning',
  'start begin launch kickoff',
  'end finish conclude',
  'grow expand increase boost rise',
  'cut reduce decrease lower slash',
  'love adore',
  'funny humorous hilarious comedic witty',
  'serious grave solemn',
  'family relatives household',
  'friend buddy pal companion',
  'mother mom mum mama',
  'father dad papa',
  'morning dawn sunrise',
  'night nighttime evening',
  'city urban downtown metropolitan',
  'nature natural outdoor scenic',
  'video clip footage film',
  'ad advert advertisement commercial spot',
  'photo picture image photograph',
  'logo emblem badge',
  'song track tune',
]);

const VOWEL = /[aeiou]/;
// Small, predictable stemmer. It only has to make two spellings of one word agree.
export function stem(word){
  let w=String(word).toLowerCase();
  if(w.length<3)return w;
  if(w.endsWith('ies')&&w.length>4)return w.slice(0,-3)+'y';
  if(/(sses|shes|ches|xes|zes)$/.test(w))return w.slice(0,-2);
  if(w.endsWith('s')&&!/(ss|us|is)$/.test(w))w=w.slice(0,-1);
  if(w.length>5&&w.endsWith('ing')&&VOWEL.test(w.slice(0,-3))){w=w.slice(0,-3);if(/([^aeiou])\1$/.test(w))w=w.slice(0,-1);}
  else if(w.length>4&&w.endsWith('ed')&&VOWEL.test(w.slice(0,-2))){w=w.slice(0,-2);if(/([^aeiou])\1$/.test(w))w=w.slice(0,-1);}
  else if(w.length>5&&w.endsWith('ly'))w=w.slice(0,-2);
  return w;
}

const GROUP_OF=new Map();
SYNONYM_GROUPS.forEach((line,i)=>{for(const word of line.split(' '))if(!GROUP_OF.has(stem(word)))GROUP_OF.set(stem(word),`g${i}`);});

// Two words with the same canonical form mean the same thing for ranking.
export function canonical(word){const s=stem(word);return GROUP_OF.get(s)||s;}

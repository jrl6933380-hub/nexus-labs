#!/usr/bin/env node
// Conservative owner navigation coverage audit. Read only; does not change the UI.
import fs from 'node:fs';
const registry=JSON.parse(fs.readFileSync(new URL('../docs/nexus-feature-registry.json',import.meta.url),'utf8'));
const messages=fs.readFileSync(new URL('../public/nexus-messages.js',import.meta.url),'utf8');
const navigation=fs.readFileSync(new URL('../public/nexus-navigation.js',import.meta.url),'utf8');
// The existing SYSTEMS list is declared before SCOPE_LABELS; capture only its literal entries.
// A missing literal ID means manual verification, not necessarily an inaccessible feature.
const block=messages.split('const SYSTEMS=[')[1]?.split('];')[0]||'';
const listedIds=[...block.matchAll(/\bid:'([^']+)'/g)].map(m=>m[1]);
const included=new Set(listedIds);
const report={
  note:'Static owner-home inventory only. Routes and renderers may provide alternate entry points. A gap requires UX verification.',
  listedSystemIds:listedIds,
  navigationBundleIds:[...navigation.matchAll(/\{id:'([^']+)',name:/g)].map(m=>m[1]),
  ownerFeatures:registry.entries.filter(e=>e.audience==='owner').map(e=>({
    id:e.id,name:e.name,route:e.route,status:e.status,ownerHome:e.owner_home,
    listedInMessages:included.has(e.id),
    review:e.status==='planned'?'planned-no-launcher':included.has(e.id)?'listed':'check-owner-entry-point'
  }))
};
const json=JSON.stringify(report,null,2)+'\n';
if(process.argv[2])fs.writeFileSync(process.argv[2],json);else process.stdout.write(json);

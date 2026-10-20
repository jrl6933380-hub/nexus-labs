// Design knowledge for agents, separate from the closed Ad Maker render grammar.
// Curated references are not templates, authorization, proof of runtime QA or weight training.
const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const atom = (id, purpose, requires, implementation) => ({id,purpose,requires,implementation,render_support:'authored_code_pattern'});

export const SITE_DESIGN_ATOMS=freeze([
 atom('product_first_composition','Make product inspection and selection the main surface.','Useful product imagery and an inventory model.','Compose imagery, condition, price and primary action together; choose the proportions for this brief.'),
 atom('editorial_artwork_plate','Treat one artwork as an editorial focal point.','A suitable owned or generated image with provenance.','Use a deliberate crop, breathing room and caption; mobile places the image below readable copy.'),
 atom('content_led_section_order','Order content around the visitor’s next decision.','A stated primary task and real content.','Choose a fresh section sequence for the brief; no required hero/services/gallery skeleton.'),
 atom('asymmetric_balance','Balance unequal areas through image weight and whitespace.','Enough content to justify the imbalance.','Use unequal tracks on wide screens, then deliberately recompose on narrow screens.'),
 atom('display_body_relationship','Give expressive headings and readable body text different jobs.','A coherent font pair with local fallbacks.','Select scale, leading, contrast and measure as a relationship, not a font preset.'),
 atom('whole_word_headlines','Keep headings readable without breaking words into fragments.','A sensible mobile headline length and type scale.','Keep word-break normal; reduce scale or stack columns before shrinking text into narrow tracks.'),
 atom('comfortable_reading_measure','Let copy breathe next to imagery.','Known viewport and copy length.','Use an intentional line length and spacing; never force long text alongside a small image on phones.'),
 atom('asset_role_plan','Plan the visual assets before treating a design as finished.','The brief, chosen composition and image rights/provenance.','Assign hero, product, detail and supporting roles; generate or obtain missing assets instead of filling slots with repeated decoration.'),
 atom('isolated_product_image','Make a product legible as a physical object.','A real supplied image or clearly identified generated concept.','Use a cutout, credible scale, deliberate background and contact shadow. Never imply an unverified brand or real stock.'),
 atom('editorial_photography','Use subject-specific imagery to establish material and atmosphere.','A relevant supplied, licensed or generated image.','Compose the crop around the page and copy; preserve useful detail and label illustrative assets accurately.'),
 atom('image_crop_control','Treat crop and focal point as part of the layout.','Image dimensions and the intended focal point.','Constrain width/height and object-fit; set mobile focal points; avoid stretched thumbnails and accidental clipping.'),
 atom('condition_detail_record','Make resale condition inspectable.','Actual condition evidence for a real listing; sample labels for a concept.','Connect overview, detail images, condition notes and selection; do not invent authentication or condition claims.'),
 atom('inventory_facets','Filter items by the attributes that matter to this catalog.','An inventory data model.','Drive displayed items and result counts from the same condition/size selections; handle no matches.'),
 atom('size_selection','Require a size before adding a sized product.','Available sizes for the selected item.','Show discrete size controls with pressed state and keyboard access; do not silently choose a size.'),
 atom('product_inspection','Let the visitor inspect a chosen item before acting.','Product details and a selected-item state.','Open an accessible detail surface; keep product, condition, sizes and price synchronized; return focus on close.'),
 atom('local_concept_bag','Demonstrate the shopping journey without implying a live purchase.','Selected product, size and sample pricing.','Keep a local-only bag and accurate count, label the concept boundary; real inventory/checkout are separate capabilities.'),
 atom('personal_enquiry','Make the first conversation fit the business.','A specific enquiry question and destination if live.','Ask relevant questions, provide clear feedback and distinguish a local preview from delivered enquiries.'),
 atom('selection_feedback','Make the consequence of a selection visible.','A local selection model.','Update the relevant summary/result, pressed state and aria-live text; avoid decorative controls.'),
 atom('mobile_recomposition','Design a phone composition rather than shrink desktop.','Content and imagery at a narrow width.','Stack competing columns, preserve full words, choose image crop and maintain comfortable touch targets.'),
 atom('contrast_and_focus','Keep the chosen identity readable and operable.','Actual foreground/background pairs and interactive states.','Check body and button contrast, keyboard focus, labels, reduced motion and reflow.'),
 atom('source_and_truth','Preserve what was actually created, selected and verified.','Stable source revision, asset provenance and user feedback.','Record visual selection separately from browser tests, real integrations and deployment; do not call reference retrieval model training.'),
]);
const IDS=new Set(SITE_DESIGN_ATOMS.map(x=>x.id));
function text(value,field,max=2000) {
 if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(`${field} must be a nonempty string of at most ${max} characters`);
 return value.trim();
}
function strings(value,field,max=16) {
 if(!Array.isArray(value)||!value.length||value.length>max)throw Error(`${field} requires 1-${max} strings`);
 return [...new Set(value.map(v=>text(v,field)))];
}
function fields(value,keys,field) {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error(`${field} must be an object`);
 for(const key of Object.keys(value))if(!keys.includes(key))throw Error(`Unsupported ${field} field: ${key}`);
}

// Validation prepares a reviewable lesson. It does not persist, execute HTML, fetch
// URLs, grant permission or authenticate a caller's claim of user selection.
export function createSiteDesignLesson(input) {
 fields(input,['id','name','source','selection','verification','atom_ids','decisions','avoid','capability_gaps'],'lesson');
 const id=text(input.id,'id',80);
 if(!/^[a-z][a-z0-9_-]*$/.test(id))throw Error('Invalid lesson id');
 fields(input.source,['url','revision','source_location'],'source');
 const sourceUrl=text(input.source.url,'source.url',500);
 if(new URL(sourceUrl).protocol!=='https:')throw Error('source.url must use HTTPS');
 fields(input.selection,['state','evidence'],'selection');
 if(input.selection.state!=='user_selected')throw Error('Only explicitly user-selected examples become curated lessons');
 fields(input.verification,['visual','browser','device','integrations'],'verification');
 if(!['user_preview','rendered_review'].includes(input.verification.visual))throw Error('Invalid visual evidence');
 for(const field of ['browser','device','integrations'])if(typeof input.verification[field]!=='boolean')throw Error(`${field} verification must be boolean`);
 const atomIds=strings(input.atom_ids,'atom_ids',SITE_DESIGN_ATOMS.length);
 for(const id of atomIds)if(!IDS.has(id))throw Error(`Unknown design atom: ${id}`);
 const gaps=input.capability_gaps===undefined?[]:input.capability_gaps;
 if(!Array.isArray(gaps)||gaps.length>16)throw Error('capability_gaps must be an array of at most 16 strings');
 return {id,name:text(input.name,'name',140),source:{url:sourceUrl,revision:text(input.source.revision,'source.revision',120),source_location:text(input.source.source_location,'source.source_location',500)},selection:{state:'user_selected',evidence:text(input.selection.evidence,'selection.evidence')},verification:clone(input.verification),atom_ids:atomIds,decisions:strings(input.decisions,'decisions'),avoid:strings(input.avoid,'avoid'),capability_gaps:gaps.map(v=>text(v,'capability_gaps')),reuse:'principles_and_capabilities_not_mandatory_layout',trust:'Curated task reference only; not permission, executable authority, runtime proof or model retraining.'};
}

export const SITE_DESIGN_LESSONS=freeze([
 createSiteDesignLesson({
  id:'sole_exchange_tiktok',name:'Sole Exchange — selected sneaker resale concept',
  source:{url:'https://nexus-ad-collection.mauveshore6.chatgpt.site/sneakers.html',revision:'cb4633c5cdc42161d2a7101c0e2117e1db36d244',source_location:'Sites appgprj_6ad6fdf5b7f08191afb3bee290317ca6 / sneaker.fragment.html'},
  selection:{state:'user_selected',evidence:'Justin selected this sneaker concept for the TikTok campaign and asked to learn the vocabulary behind its level of detail.'},
  verification:{visual:'user_preview',browser:false,device:false,integrations:false},
  atom_ids:['product_first_composition','display_body_relationship','asset_role_plan','isolated_product_image','image_crop_control','condition_detail_record','inventory_facets','size_selection','product_inspection','local_concept_bag','selection_feedback','mobile_recomposition','source_and_truth'],
  decisions:['Build the product imagery, condition notes, size choices and bag as one connected customer journey.','Use condensed display type against a quieter inventory surface; preserve readable copy and whole words.','Use generated isolated concept products with defined crops, rather than decorative photos unrelated to the buying task.','Preserve filters, result counts, selected product, available sizes and local bag state together.'],
  avoid:['Copying this store skeleton or lime/olive styling onto unrelated businesses.','Treating placeholder products, prices, authentication or stock as real inventory.','Calling a user-selected preview production-tested.'],
  capability_gaps:['Real condition photography, stock synchronization, authentication, checkout and fulfillment are not implemented.','The closed stock Ad Maker player does not execute this custom website or its shopping interactions.'],
 }),
 createSiteDesignLesson({
  id:'stillmark_editorial',name:'Stillmark — selected independent tattoo atelier concept',
  source:{url:'https://nexus-ad-collection.mauveshore6.chatgpt.site/tattoo.html',revision:'c08b6edb643beac1a91279c6611d807d83bd3083',source_location:'Sites appgprj_6ad6fdf5b7f08191afb3bee290317ca6 / stillmark.fragment.html'},
  selection:{state:'user_selected',evidence:'Justin selected the independently authored inline tattoo design, then asked to save it for the ads.'},
  verification:{visual:'user_preview',browser:false,device:false,integrations:false},
  atom_ids:['editorial_artwork_plate','content_led_section_order','asymmetric_balance','display_body_relationship','whole_word_headlines','comfortable_reading_measure','asset_role_plan','image_crop_control','personal_enquiry','mobile_recomposition','source_and_truth'],
  decisions:['Make the artwork and conversational typography establish an independent studio identity.','Use an editorial plate and restrained rules to support the artwork; avoid filling every section with cards.','Let the reading rhythm and consultation flow determine the page instead of a fixed service-gallery skeleton.','Stack image and copy on phones before either becomes a narrow unreadable column.'],
  avoid:['Forcing the previous oversized condensed heading into a narrow text column.','Applying the same serif, olive palette and tilted plate to every business.','Presenting generated illustration as a tattoo performed for a real client.'],
  capability_gaps:['A real artist portfolio and delivered booking/enquiry integration remain separate work.','Direct HTML resolved the blank wrapper handoff, but real device/browser QA is still unverified.'],
 }),
]);

export const SITE_DESIGN_LEARNING_WORKFLOW=freeze([
 {id:'design_first',action:'Start from the business, visitor task and user brief. Design a distinct concept; references inform decisions but do not dictate a template.'},
 {id:'review_together',action:'Show the actual design and relevant interactions. Incorporate the user’s feedback. Do not treat a bulk-generated example as a selected quality reference.'},
 {id:'preserve_selected_source',action:'When the user selects a version, save exact editable source, assets, provenance and a stable revision. Keep alternative authors/designs separate.'},
 {id:'extract_decisions',action:'Record why composition, type hierarchy, asset roles, spacing and interactions work together. Separate transferable principles from that business’s identity.'},
 {id:'map_and_identify_gaps',action:'Map the lesson to existing design atoms and runtime capabilities. Record missing capabilities explicitly; propose/test actual primitives before advertising support.'},
 {id:'verify_honestly',action:'Track visual selection, browser/device tests and real integrations separately. Preserve concept boundaries and privacy/tenant restrictions.'},
 {id:'save_knowledge',action:'Validate a lesson, review it, then save it with its source in the versioned Vault or curated source registry. The validator alone does not store it. Do not silently promote a reference to proven.'},
 {id:'apply_with_judgment',action:'On a new brief, retrieve relevant lessons, choose only useful techniques and compose a new design. Reuse reliable mechanics, not a mandatory page skeleton. Re-review the resulting site.'},
]);

export function describeSiteDesignVocabulary() {
 return clone({version:'1.0.0',kind:'design_knowledge_not_render_grammar',intent:'Learn transferable visual and interaction techniques from exact user-selected site versions, then compose distinct sites.',trust:'Task guidance only. Does not authorize writes, publication, purchases or model training.',render_boundary:'These atom IDs are authored code patterns, not new save_nexus_ad_v2 scene IDs. Keep the existing Ad Maker grammar/validation unchanged. A described idea is not a supported renderer primitive.',atoms:SITE_DESIGN_ATOMS,lessons:SITE_DESIGN_LESSONS.map((lesson,index)=>({...lesson,name:index===0?'Product-first resale study':'Editorial artist studio study',source:{visibility:'owner_private',lookup:'Retrieve the exact source from the connected owner’s authorized Vault/workspace; never borrow another user’s source.'},selection:{state:'user_selected',evidence:'Selected by the source owner. Exact feedback and source identifiers remain with that owner.'}})),workflow:SITE_DESIGN_LEARNING_WORKFLOW,storage:'Curated code registry plus versioned Vault references. createSiteDesignLesson validates records only; it does not persist them.',retrieval:'Search relevant lessons and Vault records before building; apply principles selectively. Never automatically reproduce an example’s full layout.'});
}

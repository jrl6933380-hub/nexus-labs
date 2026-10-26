import { SERVICE_TEMPLATES, renderServiceTemplate } from './forge-service-templates.js';

const EXAMPLES = {
  barber: { businessName: 'Marlow Barber Studio', category: 'Barber', location: 'Your neighborhood', siteContent: { headline: 'A good cut changes the day.', intro: 'A sample direction for a local barbershop. Put your own approach, services, and personality here.', services: [{name:'Signature cut',price:'$35',sample:true},{name:'Cut & beard',price:'$50',sample:true},{name:'Beard detail',price:'$20',sample:true},{name:'Full refresh',price:'$65',sample:true}] } },
  nails: { businessName: 'Sunday Nail Studio', category: 'Nail salon', location: 'Your neighborhood', siteContent: { headline: 'A little color. A little you.', intro: 'A sample direction for a nail studio. Show your style, your favorite finishes, and how clients can visit.', services: [{name:'Signature manicure',price:'$30',sample:true},{name:'Gel color',price:'$45',sample:true},{name:'Nail art',price:'Ask us',sample:true},{name:'Pedicure',price:'$50',sample:true}] } },
  studio: { businessName: 'The Neighborhood Studio', category: 'Appointment studio', location: 'Your neighborhood', siteContent: { headline: 'Good care starts here.', intro: 'A sample direction for your service business. Introduce your craft and give clients a clear next step.', services: [{name:'Signature appointment',price:'Ask us',sample:true},{name:'Consultation',price:'Ask us',sample:true},{name:'Detail service',price:'Ask us',sample:true}] } },
};
let template = 'editorial', business, output = '';
const el = id => document.getElementById(id);
function render() {
  business.businessName = el('business-name').value;
  business.siteContent.headline = el('headline').value;
  business.siteContent.intro = el('intro').value;
  output = renderServiceTemplate(business, template);
  el('preview').srcdoc = output;
  el('direction-description').textContent = SERVICE_TEMPLATES.find(t => t.id === template).description;
}
function loadExample() {
  business = JSON.parse(JSON.stringify(EXAMPLES[el('business-kind').value]));
  el('business-name').value = business.businessName;
  el('headline').value = business.siteContent.headline;
  el('intro').value = business.siteContent.intro;
  el('services-editor').replaceChildren();
  business.siteContent.services.forEach((service, index) => {
    const label = document.createElement('label');label.textContent = 'Sample service ' + (index + 1);
    const row = document.createElement('div');row.className = 'service-fields';
    for (const field of ['name','price']) {
      const input = document.createElement('input');input.value = service[field];input.maxLength = field === 'name' ? 100 : 40;
      input.setAttribute('aria-label', 'Service '+(index+1)+' '+field);
      input.addEventListener('input', () => { service[field] = input.value;render(); });row.append(input);
    }
    label.append(row);el('services-editor').append(label);
  });
  render();
}
el('business-kind').addEventListener('change',loadExample);
for (const id of ['business-name','headline','intro']) el(id).addEventListener('input',render);
document.querySelectorAll('[data-template]').forEach(button => button.addEventListener('click',() => {
  template = button.dataset.template;
  document.querySelectorAll('[data-template]').forEach(b => b.setAttribute('aria-pressed',String(b === button)));
  render();
}));
document.querySelectorAll('[data-size]').forEach(button => button.addEventListener('click',() => {
  el('viewport').classList.toggle('phone',button.dataset.size === 'phone');
  document.querySelectorAll('[data-size]').forEach(b => b.setAttribute('aria-pressed',String(b === button)));
}));
el('download').addEventListener('click',() => {
  const url = URL.createObjectURL(new Blob([output],{type:'text/html'}));
  const link = document.createElement('a');link.href=url;
  link.download=(business.businessName.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,60)||'business')+'-'+template+'.html';
  link.click();setTimeout(() => URL.revokeObjectURL(url),30000);
});
loadExample();

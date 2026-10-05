// Plain-language descriptions and examples shared by Explore and in-space help.
// Example buttons only draft a message; they never start work or change data.
export const NEXUS_INTRO = Object.freeze({
  title:'One place to think, plan, remember, and create.',
  description:'Use Nexus for everyday life, personal projects, or work. Keep a recipe, set a reminder, organize an idea, research a question, or build something.',
});
const example=(label,prompt)=>({label,prompt});
export const QUICK_STARTS = Object.freeze([
  example('Keep a recipe','Help me organize a recipe I want to keep. Ask me for the ingredients and instructions.'),
  example('Remember something','Help me set a reminder. Ask me what I need to remember and when.'),
  example('Plan my week','Help me plan a realistic week around my commitments and time for myself. Ask me what matters first.'),
  example('Make something','Help me turn an everyday idea into a website, tracker, calculator, or visual page. Ask me what I want to make.'),
]);
export const NEXUS_GUIDE = Object.freeze([
  {id:'chat',name:'Chat with Nex',view:'chat',section:'Everyday life',icon:'N',description:'Talk about a question, an idea, your day, or a decision. You can start in plain language without choosing a tool.',uses:'Understand a confusing topic, brainstorm a gift, draft a message, or work through your options.',examples:[example('Compare my options','Help me compare some options and decide what fits my situation. Ask me what I am deciding.'),example('Draft a message','Help me write a message. Ask who it is for and what I want to say.')]},
  {id:'memory',name:'Notes, recipes & memory',view:'memory',section:'Everyday life',icon:'M',description:'Use saved conversations for notes, recipes, lists, and ideas. Ask Nex to remember important details you want carried into later conversations.',uses:'Keep a family recipe in a chat, organize a grocery list, or remember a preference. Memory lets you review what Nex has stored and ask for corrections or removal.',examples:[QUICK_STARTS[0],example('Remember a preference','I want you to remember an important preference for future conversations. Ask me what it is.')]},
  {id:'reminders',name:'Reminders',view:'reminders',section:'Everyday life',icon:'✓',description:'Capture something you need to do later, then choose when it should be due. Mark it done when you finish.',uses:'Call someone, pick up groceries, remember a birthday, or follow up on something. Phone alerts can be enabled from More on a supported device.',examples:[QUICK_STARTS[1],example('A grocery reminder','Help me set a reminder to pick up groceries. Ask me for the list and the time.')]},
  {id:'planner',name:'Schedule',view:'planner',section:'Everyday life',icon:'◷',description:'Give activities a place in your day or week. See your commitments, open time, and conflicts before adjusting your plan.',uses:'Make time for studying, family, exercise, an appointment, a hobby, or a project.',examples:[QUICK_STARTS[2],example('Make time for a hobby','Help me find time for a hobby in my schedule without moving existing commitments. Ask me about the hobby and how long I need.')]},
  {id:'life',name:'Nexus Life',view:'life',section:'Everyday life',icon:'✦',description:'Plan activities around what matters to you and check in on how they felt. Use your priorities and recorded experiences to shape your next week.',uses:'Plan meal preparation or an evening routine, make room for people you care about, and reflect on energy and balance.',examples:[example('Plan my meals','Help me plan meals around foods I enjoy, my budget, and the time I have to cook. Ask about my preferences first.'),example('An evening routine','Help me plan a realistic evening routine and record how it works for me. Ask me about my current habits and schedule.')]},
  {id:'research',name:'Research agents',view:'messages',section:'Create & collaborate',icon:'R',description:'Create a specialist with a research job, then ask it to investigate a question and organize what it finds.',uses:'Compare ingredients, explore a hobby, learn about a topic, or gather sources for a project. Type @ in a chat to pick an agent you have saved.',examples:[example('Research a topic','I want to research a topic with a saved research specialist. Help me choose one, or show me how to create one if I do not have one. Ask what I want to investigate.')]},
  {id:'build',name:'Builder agents',view:'messages',section:'Create & collaborate',icon:'B',description:'Give a build specialist a clear job and the access it needs. Call it from another chat when you want something made.',uses:'Turn food choices into a meal-planning page, make a sleep-habit overview, or build a calculator or hobby site. Visual previews can stay in the same conversation.',examples:[example('A visual meal page','Help me ask a saved builder agent to make a visual page for my food choices. First ask what information I want on the page.'),example('A habit tracker','Help me plan a simple tracker for a habit I choose. Ask what I want to track, then help me choose a builder agent.')]},
  {id:'groups',name:'Agent groups & @mentions',view:'messages',section:'Create & collaborate',icon:'@',description:'Mix saved specialists in a group, with Nex optional. You or an agent can ask another specialist for help in the current conversation.',uses:'Research gathers recipes, Life helps plan the week, and Builder makes a meal page. Review the saved assignments, start the work, and follow named results and handoffs in the chat.',examples:[example('Put a team together','Help me choose saved agents for a meal-planning project: research recipes, plan the week, then make a visual page. Show me how to start their group with Nex optional.')]},
  {id:'workbench',name:'Projects',view:'workbench',section:'Create & collaborate',icon:'◫',description:'Keep the websites, apps, and tools you build together. Open a project to preview it or continue editing it.',uses:'A personal website, recipe organizer, event page, calculator, or small-business tool. Your plan controls available project slots.',examples:[QUICK_STARTS[3],example('A recipe organizer','Help me plan a recipe organizer as a project. Ask what recipes, search options, and pages I need before building.')]},
  {id:'story',name:'Story Studio',view:'story',section:'Create & collaborate',icon:'S',description:'Work on stories, comic scenes, and characters with Nexus.',uses:'Develop a character, plan a short comic, or turn a chapter into scenes.',examples:[example('Start a story','Help me plan a short story or comic. Ask about the characters, setting, and mood before creating scenes.')]},
  {id:'legacy',name:'Nexus Legacy',view:'legacy',section:'In planning',icon:'◇',status:'Planned',description:'A dedicated place for people, memories, lessons, and moments is in planning. The current space introduces that idea.',uses:'Today, you can write about a memory with Nex and keep the conversation. Dedicated Legacy collections and shared rooms are planned.',examples:[example('Write about a memory','Help me write about a memory of someone important to me. Ask what I would like to share, and help me put it into words.')]},
  {id:'teams',name:'Nexus Teams',view:'teams',section:'In planning',icon:'⬡',status:'Planned',description:'A workspace for multiple people and their agents is in planning. This is separate from the agent groups you can already create in Messages.',uses:'Plan how a family, club, or business could organize shared work. Use Messages today to group your own agents.',examples:[example('Plan shared work','Help me outline how a small team could organize a project. We can plan the workflow now; do not assume shared member accounts are available.')]},
  {id:'deck',name:'Command Deck',view:'deck',section:'Workspace management',icon:'⌁',description:'See the board and work that needs attention across your workspace.',uses:'Review tasks, spot a blocker, and decide what to work on next.',examples:[example('What needs attention?','Read the current board and tell me which tasks need my attention and why.')]},
  {id:'approvals',name:'Approvals',view:'approvals',section:'Workspace management',icon:'✓',description:'Review saved requests for consequential actions before deciding whether to approve them.',uses:'Check what an agent is asking to change, then approve or reject the request.',examples:[example('Explain a request','Explain my pending approval requests in plain language, including what each would change. Do not approve anything yet.')]},
  {id:'forge',name:'Forge',view:'forge',section:'Workspace management',icon:'F',description:'Manage the builder product and its connected work.',uses:'Review builder activity or open Forge to start and continue a build.',examples:[example('Explain Forge','Explain how Forge and my Projects space work together, and help me choose where to start.')]},
  {id:'agents',name:'AI Team',view:'agents',section:'Workspace management',icon:'A',description:'See the connected development agents and the work they own. Create your personal specialists and groups in Messages.',uses:'Check who owns a task, what is underway, and whether an agent is blocked.',examples:[example('Who is working on what?','Read the agent board and show who is working on what, using saved status rather than guesses.')]},
  {id:'ventures',name:'Ventures',view:'ventures',section:'Workspace management',icon:'V',description:'Organize business ideas and the work needed to develop them.',uses:'Outline a service, break an idea into steps, or review an existing venture.',examples:[example('Explore an idea','Help me outline a business idea and the first small steps to test it. Ask about the idea before planning.')]},
  {id:'pod',name:'Pod Room',view:'pod',section:'Workspace management',icon:'P',description:'Check and manage the connected AI runtime for this workspace.',uses:'See whether the runtime is available and ask Nex to explain its current state.',examples:[example('Check availability','Check the connected AI runtime and explain its current availability. Do not start, stop, or restart it.')]},
  {id:'skills',name:'Capabilities',view:'skills',section:'Workspace management',icon:'C',description:'Explore the connected skills and actions Nexus can use.',uses:'Find out whether a task has a connected capability and which space to use.',examples:[example('What can help with my task?','Help me find the connected capabilities for a task I have in mind. Ask about the task and explain the practical options.')]},
]);

const node=(tag,text,cls='')=>{const el=document.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;return el;};
const button=(label,action,cls='')=>{const el=node('button',label,cls);el.type='button';el.onclick=action;return el;};
export async function draftNexusExample({input,openMain},text){
  const existing=input.value.trim();
  await openMain();
  input.value=existing && existing!==text?`${existing}\n\n${text}`:text;
  input.focus();
}
export function renderExampleButtons(examples,ctx){
  const host=node('div',undefined,'guideexamples');
  for(const item of examples)host.append(button(item.label,()=>ctx.draftPrompt?.(item.prompt),'guideexample'));
  return host;
}
function explanation(entry,ctx){
  const body=node('div',undefined,'guidebody');body.append(node('p',entry.description),node('p',entry.uses,'guideuses'));
  body.append(renderExampleButtons(entry.examples,ctx),node('small','Examples fill your chat. Edit the message, then send it when you are ready.','guidedraftnote'));
  return body;
}
export function renderFeatureHelp(id,ctx){
  const entry=NEXUS_GUIDE.find(item=>item.id===id);if(!entry)return null;
  const details=node('details',undefined,'featurehelp');details.append(node('summary',`What can I use ${entry.name} for?`),explanation(entry,ctx));return details;
}
export function findGuideEntries(query=''){
  const words=String(query).trim().toLowerCase().split(/\s+/u).filter(Boolean);
  return NEXUS_GUIDE.filter(entry=>{const text=[entry.name,entry.description,entry.uses,...entry.examples.map(item=>item.label+' '+item.prompt)].join(' ').toLowerCase();return words.every(word=>text.includes(word));});
}
export function renderNexusGuide(ctx){
  const root=node('section',undefined,'nexusguide'),header=node('header',undefined,'guideintro');
  header.append(node('small','EVERYDAY LIFE · PROJECTS · WORK','guideeyebrow'),node('h1',NEXUS_INTRO.title),node('p',NEXUS_INTRO.description));
  root.append(header,renderExampleButtons(QUICK_STARTS,ctx),node('p','Tap an example to draft a message. Nothing runs until you send it.','guidedraftnote'));
  const search=node('input');search.type='search';search.placeholder='Try recipes, sleep, birthdays, or websites';search.setAttribute('aria-label','Find a practical use for Nexus');
  const status=node('p',undefined,'guidestatus');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const list=node('div',undefined,'guidefeatures');
  function draw(){
    list.replaceChildren();const entries=findGuideEntries(search.value);
    for(const section of ['Everyday life','Create & collaborate','In planning','Workspace management']){
      const items=entries.filter(entry=>entry.section===section);if(!items.length)continue;
      list.append(node('h2',section));
      for(const entry of items){
        const card=node('details',undefined,'guidefeature'),summary=node('summary'),icon=node('span',entry.icon,'guideicon');icon.setAttribute('aria-hidden','true');
        summary.append(icon,node('strong',entry.name));if(entry.status)summary.append(node('small',entry.status,'guideplanned'));
        const body=explanation(entry,ctx);body.append(button(entry.status?'Open introduction':entry.id==='chat'?'Open chat':`Open ${entry.name}`,()=>entry.view==='chat' && ctx.openConversation?ctx.openConversation({kind:'nex',name:'Nex'}):ctx.openSystem?ctx.openSystem(entry.view):ctx.go(entry.view),'guideopen'));
        card.append(summary,body);list.append(card);
      }
    }
    status.textContent=search.value.trim()?`${entries.length} feature${entries.length===1?'':'s'} found. ${entries.length?'Open one for ideas.':'Try another word or ask Nex about your idea.'}`:'';
  }
  search.oninput=draw;root.append(search,status,list,button('Back to Messages',()=>ctx.go('messages'),'guideback'));draw();return root;
}

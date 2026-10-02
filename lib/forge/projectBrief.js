// lib/forge/projectBrief.js
// Structured, durable customer requirements for Forge projects.
//
// The brief is intentionally separate from chat history. Chat is a useful
// conversation surface; the brief is the trusted, queryable source Nex uses
// to decide what to build and which stack capabilities the project needs.

const BRIEF_VERSION = 2;
const BRIEF_KEY_PREFIX = 'nexus:forge:brief:';

const BASE_QUESTIONS = Object.freeze([
  {
    id: 'idea', field: 'idea', type: 'long_text', required: true,
    question: 'What do you want Nex to build?',
    helper: 'Describe it normally. A sentence or two is enough to get started.',
    placeholder: 'A website for my restaurant that shows the menu and lets people reserve a table…',
  },
  {
    id: 'project_type', field: 'project_type', type: 'single_select', required: true,
    question: 'What kind of project is this closest to?',
    helper: 'Pick the closest match. You can add a note if yours is different.',
    options: [
      { value: 'business_website', label: 'Business website' },
      { value: 'store', label: 'Online store' },
      { value: 'booking', label: 'Booking or appointments' },
      { value: 'app', label: 'Web app or portal' },
      { value: 'portfolio', label: 'Portfolio or personal site' },
      { value: 'personal_tool', label: 'Personal or internal tool' },
      { value: 'intelligence', label: 'AI assistant or intelligence' },
      { value: 'other', label: 'Something different' },
    ],
    allow_comment: true,
  },
  {
    id: 'primary_goals', field: 'primary_goals', type: 'multi_select', required: true,
    question: 'What should this help people do?',
    helper: 'Choose every result that matters. Nex will organize them into the right experience.',
    options: [
      { value: 'learn', label: 'Learn about us' },
      { value: 'contact', label: 'Contact us' },
      { value: 'book', label: 'Book or reserve' },
      { value: 'buy', label: 'Buy something' },
      { value: 'sign_in', label: 'Create an account' },
      { value: 'submit', label: 'Send information' },
    ],
    allow_comment: true,
  },
  {
    id: 'audience', field: 'audience', type: 'single_select', required: true,
    question: 'Who is this mainly for?',
    helper: 'This helps Nex choose the language, layout, and most important actions.',
    options: [
      { value: 'local_customers', label: 'Local customers' },
      { value: 'online_customers', label: 'Online customers' },
      { value: 'businesses', label: 'Other businesses' },
      { value: 'members', label: 'Members or employees' },
      { value: 'fans', label: 'Followers or a community' },
      { value: 'self', label: 'Just me' },
      { value: 'mixed', label: 'A mix of people' },
    ],
    allow_comment: true,
  },
  {
    id: 'style', field: 'style', type: 'single_select', required: true,
    question: 'What should it feel like?',
    helper: 'Nex will turn this direction into a complete visual system.',
    options: [
      { value: 'clean', label: 'Clean and professional' },
      { value: 'bold', label: 'Bold and energetic' },
      { value: 'warm', label: 'Warm and welcoming' },
      { value: 'premium', label: 'Premium and refined' },
      { value: 'playful', label: 'Playful and creative' },
      { value: 'nex_decides', label: 'Let Nex decide' },
    ],
    allow_comment: true,
  },
  {
    id: 'content', field: 'content_ready', type: 'multi_select', required: true,
    question: 'What do you already have ready?',
    helper: 'This tells Nex what to use now and what to leave as a clear placeholder.',
    options: [
      { value: 'logo', label: 'Logo' },
      { value: 'photos', label: 'Photos' },
      { value: 'copy', label: 'Written information' },
      { value: 'prices', label: 'Prices or services' },
      { value: 'hours', label: 'Hours and location' },
      { value: 'nothing', label: 'Nothing yet' },
    ],
    allow_comment: true,
  },
]);

const TYPE_FEATURES = Object.freeze({
  store: [
    { value: 'payments', label: 'Online payments' },
    { value: 'products', label: 'Product catalog' },
    { value: 'shipping', label: 'Shipping or pickup' },
    { value: 'accounts', label: 'Customer accounts' },
  ],
  booking: [
    { value: 'bookings', label: 'Available time slots' },
    { value: 'reminders', label: 'Confirmations and reminders' },
    { value: 'payments', label: 'Deposits or payments' },
    { value: 'accounts', label: 'Customer accounts' },
  ],
  app: [
    { value: 'accounts', label: 'User accounts' },
    { value: 'dashboard', label: 'Private dashboard' },
    { value: 'database', label: 'Saved information' },
    { value: 'payments', label: 'Subscriptions or payments' },
  ],
  business_website: [
    { value: 'forms', label: 'Contact or quote form' },
    { value: 'hours', label: 'Hours and location' },
    { value: 'testimonials', label: 'Customer reviews' },
    { value: 'email', label: 'Email follow-up' },
  ],
  portfolio: [
    { value: 'gallery', label: 'Project gallery' },
    { value: 'forms', label: 'Contact form' },
    { value: 'resume', label: 'Experience or résumé' },
    { value: 'social', label: 'Social links' },
  ],
  personal_tool: [
    { value: 'database', label: 'Save my information' },
    { value: 'uploads', label: 'Import files' },
    { value: 'accounts', label: 'Private sign-in' },
    { value: 'email', label: 'Notifications' },
  ],
  intelligence: [
    { value: 'database', label: 'Remember information' },
    { value: 'uploads', label: 'Read my files' },
    { value: 'accounts', label: 'Private sign-in' },
    { value: 'email', label: 'Email or notifications' },
  ],
  other: [
    { value: 'accounts', label: 'User accounts' },
    { value: 'database', label: 'Saved information' },
    { value: 'payments', label: 'Payments' },
    { value: 'email', label: 'Email or notifications' },
  ],
});

function featureQuestion(projectType) {
  return {
    id: 'features', field: 'features', type: 'multi_select', required: true,
    question: 'Which useful pieces should the first version include?',
    helper: 'Pick what matters now. Nex can recommend more after you see the first version.',
    options: [...(TYPE_FEATURES[projectType] || TYPE_FEATURES.other), { value: 'none', label: 'No connected services needed yet' }],
    allow_comment: true,
  };
}

function normalizeOwner(value) {
  const owner = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{1,120}$/.test(owner)) throw new Error('A valid ownerUsername is required.');
  return owner;
}

function normalizeProjectId(value = 'default') {
  const id = String(value || 'default').trim();
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) throw new Error('Invalid projectId.');
  return id;
}

function cleanText(value, max = 1200) {
  return String(value || '').trim().slice(0, max);
}

function cleanValues(value) {
  const values = Array.isArray(value) ? value : (value === undefined || value === null ? [] : [value]);
  return [...new Set(values.map((item) => cleanText(item, 80)).filter(Boolean))].slice(0, 20);
}

function questionsFor(brief) {
  if (brief.mode === 'addon') {
    const kind = brief.addition_kind;
    const questions = [
      { id: 'idea', field: 'idea', type: 'long_text', required: true,
        question: kind === 'page' ? 'What should this new page help someone do?'
          : kind === 'tool' ? 'What job should this tool or workflow complete?'
            : kind === 'intelligence' ? 'What should this intelligence help with?'
              : 'What do you want to add or change?',
        helper: kind ? 'Give one real example. Nex will use it to shape only the questions this piece needs.' : 'Describe the addition to this existing project.',
        placeholder: kind === 'intelligence' ? 'Help visitors choose the right service using our real information…'
          : kind === 'tool' ? 'Calculate a quote from the customer’s choices…' : 'Add bookings to my existing site…' },
      { id: 'placement', field: 'placement', type: 'long_text', required: true, question: 'Where should it fit into the current site?', helper: 'Say which page, section, button, or tool should open it and how people should get back.' },
    { id: 'features', field: 'features', type: 'multi_select', required: true, question: 'What does this addition need to do?', helper: 'Nex will map these needs to connections and show what is already ready.', options: [
      { value: 'none', label: 'Visual or content changes only' },
      { value: 'accounts', label: 'Sign-in or customer accounts' },
      { value: 'database', label: 'Save information' },
      { value: 'bookings', label: 'Bookings or appointments' },
      { value: 'payments', label: 'Payments' },
      { value: 'email', label: 'Email or notifications' },
      { value: 'uploads', label: 'Upload files or images' },
    ], allow_comment: true },
    ];
    if (kind === 'intelligence') questions.push({ id: 'intelligence_rules', field: 'intelligence_rules', type: 'long_text', required: true,
      question: 'What should it know, and what must it ask before doing?',
      helper: 'Name its trusted information, what makes a good answer, and any actions that always need approval.' });
    const features = Array.isArray(brief.answers?.features) ? brief.answers.features : [];
    if (kind && features.some(value => ['accounts', 'database', 'uploads'].includes(value))) questions.push({ id: 'data_rules', field: 'data_rules', type: 'long_text', required: true,
      question: 'What information can this piece use and save?', helper: 'Name who can see it, what should be remembered, and what should stay private.' });
    if (kind && features.some(value => ['bookings', 'payments'].includes(value))) questions.push({ id: 'operating_rules', field: 'operating_rules', type: 'long_text', required: true,
      question: 'What rules should the booking or payment follow?', helper: 'Include prices or deposits, availability, confirmations, cancellations, and failure handling.' });
    questions.push({ id: 'preserve', field: 'preserve', type: 'long_text', required: true, question: 'What must stay the same, and how will you know this works?', helper: 'Name anything Nex must preserve, what makes this piece distinct, and one result that proves it works.' });
    return questions;
  }
  if (brief.version >= 2) return adaptiveQuestions(brief);
  const questions = [...BASE_QUESTIONS];
  questions.push(featureQuestion(brief.answers?.project_type));
  return questions;
}

// Only explicit answers remove audience questions; keywords guide wording, not
// assumed requirements. Each new answer recomputes the remaining interview.
function adaptiveQuestions(brief) {
  const answers = brief.answers || {};
  const text = [answers.idea, answers.workflow].filter(Boolean).join(' ');
  const personal = /\b(for myself|for my own use|just (for )?me|only (for )?me)\b/i.test(text);
  const type = answers.project_type;
  const tool = ['personal_tool', 'intelligence', 'app', 'other'].includes(type);
  const intelligence = type === 'intelligence';
  const question = (id, title, helper) => ({ id, field: id, type: 'long_text', required: true, question: title, helper });
  const kind = { ...BASE_QUESTIONS[1],
    question: /\b(ai|assistant|intelligence|agent)\b/i.test(answers.idea || '')
      ? 'Is this an intelligence, a tool, or another kind of project?'
      : /\b(tool|calculator|tracker|dashboard)\b/i.test(answers.idea || '')
        ? 'Is this a personal tool, a shared app, or another kind of project?'
        : BASE_QUESTIONS[1].question,
    helper: 'Confirm the closest match so Nex asks the right follow-ups.' };
  const questions = [BASE_QUESTIONS[0], kind];
  if (!personal) questions.push(BASE_QUESTIONS[3]);
  questions.push(question('workflow', intelligence
    ? 'What should this intelligence take in, and what should it give back?'
    : tool ? 'Walk through one real task this tool should help you finish.'
      : 'What is the main thing a visitor should do, from arriving to finishing?',
    'Give a concrete example: the starting information, the steps, and the useful result. Include what makes your approach different.'));
  questions.push(featureQuestion(type));
  const features = Array.isArray(answers.features) ? answers.features : [];
  if (intelligence) questions.push(question('intelligence_rules',
    'What should it know, and what is it allowed to do?',
    'Name its knowledge sources, how you will judge a good answer, and which actions need your approval. Nex will distinguish a working integration from a demonstration.'));
  if (features.some(value => ['database', 'accounts', 'uploads'].includes(value))) {
    questions.push(question('data_rules', 'What information should it use, save, and keep private?',
      (personal || answers.audience === 'self') ? 'Describe your inputs, where they come from, and what should be remembered or deleted.'
        : 'Describe the information, who can read or change it, and what should be remembered or deleted.'));
  }
  if (features.some(value => ['payments', 'bookings', 'shipping', 'products'].includes(value))) {
    questions.push(question('operating_rules', 'What rules should the booking or purchase follow?',
      'Include the applicable prices, availability, confirmation, cancellation, delivery, and failure handling. Say which details Nex should help you decide.'));
  }
  if (!tool) questions.push(BASE_QUESTIONS[4], BASE_QUESTIONS[5]);
  questions.push(question('success', 'What would make the first version feel right for you?',
    tool ? 'Name the result you want to test, any must-haves, and any layout or behavior preferences. Keep it simple if the idea is simple.'
      : 'Name the must-haves, what should make this different, and a concrete way to check the first version works.'));
  return questions;
}

export function createProjectBrief({ ownerUsername, projectId = 'default', mode = 'new' } = {}) {
  const now = Date.now();
  return {
    version: BRIEF_VERSION,
    mode: mode === 'addon' ? 'addon' : 'new',
    owner: normalizeOwner(ownerUsername),
    project_id: normalizeProjectId(projectId),
    status: 'interviewing',
    answers: {},
    comments: {},
    created_at: now,
    updated_at: now,
  };
}

export function briefProgress(brief) {
  const questions = questionsFor(brief);
  const required = questions.filter((question) => question.required);
  const answered = required.filter((question) => {
    const value = brief.answers?.[question.field];
    return Array.isArray(value) ? value.length > 0 : Boolean(String(value || '').trim());
  });
  return {
    answered: answered.length,
    required: required.length,
    percent: required.length ? Math.round((answered.length / required.length) * 100) : 100,
    ready: answered.length === required.length,
  };
}

export function nextBriefQuestion(brief) {
  return questionsFor(brief).find((question) => {
    const value = brief.answers?.[question.field];
    return Array.isArray(value) ? value.length === 0 : !String(value || '').trim();
  }) || null;
}

export function answerProjectBrief(brief, { questionId, values, comment } = {}) {
  brief.answers ||= {};
  brief.comments ||= {};
  const question = questionsFor(brief).find((item) => item.id === questionId);
  if (!question) throw new Error('Unknown brief question.');
  const cleaned = question.type === 'multi_select'
    ? cleanValues(values)
    : cleanText(Array.isArray(values) ? values[0] : values, question.type === 'long_text' ? 1600 : 120);
  if ((Array.isArray(cleaned) ? cleaned.length === 0 : !cleaned) && question.required) {
    throw new Error('Choose an answer or add a focused comment.');
  }
  if (question.options) {
    const selected = Array.isArray(cleaned) ? cleaned : [cleaned];
    if (selected.some(value => !question.options.some(option => option.value === value))) throw new Error('Choose a listed answer.');
    if (selected.includes('none') && selected.length > 1) throw new Error('Choose no connected services or the services you need, not both.');
  }
  if (brief.version >= 2 && brief.mode !== 'addon' && brief.answers[question.field] !== undefined
      && JSON.stringify(brief.answers[question.field]) !== JSON.stringify(cleaned)) {
    // A revised starting idea or kind must not silently reuse an old plan.
    const downstream = question.id === 'idea' ? Object.keys(brief.answers).filter(field => field !== 'idea')
      : question.id === 'project_type' ? Object.keys(brief.answers).filter(field => !['idea', 'project_type'].includes(field))
        : question.id === 'features' ? ['data_rules', 'operating_rules', 'success'] : [];
    for (const field of downstream) { delete brief.answers[field]; delete brief.comments[field]; }
  }
  brief.answers[question.field] = cleaned;
  const note = cleanText(comment, 600);
  if (note) brief.comments[question.field] = note;
  else delete brief.comments[question.field];
  delete brief.approved_at;
  brief.updated_at = Date.now();
  brief.status = briefProgress(brief).ready ? 'ready' : 'interviewing';
  return brief;
}

function briefKey(ownerUsername, mode = 'new') {
  return BRIEF_KEY_PREFIX + normalizeOwner(ownerUsername) + (mode === 'addon' ? ':addon' : '');
}

async function redisCommand(command) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error('Project Brief storage failed');
  return data.result;
}

export function createRedisBriefStore() {
  return {
    async get(key, field) {
      const raw = await redisCommand(['HGET', key, field]);
      return raw ? JSON.parse(raw) : null;
    },
    async set(key, field, value) {
      await redisCommand(['HSET', key, field, JSON.stringify(value)]);
    },
    async delete(key, field) {
      await redisCommand(['HDEL', key, field]);
    },
  };
}

export function createMemoryBriefStore() {
  const hashes = new Map();
  const hash = (key) => {
    if (!hashes.has(key)) hashes.set(key, new Map());
    return hashes.get(key);
  };
  return {
    async get(key, field) { return hash(key).get(field) || null; },
    async set(key, field, value) { hash(key).set(field, structuredClone(value)); },
    async delete(key, field) { hash(key).delete(field); },
  };
}

export async function getProjectBrief({ ownerUsername, projectId = 'default', mode = 'new', store = createRedisBriefStore() } = {}) {
  return store.get(briefKey(ownerUsername, mode), normalizeProjectId(projectId));
}

export async function ensureProjectBrief({ ownerUsername, projectId = 'default', mode = 'new', store = createRedisBriefStore() } = {}) {
  const key = briefKey(ownerUsername, mode);
  const field = normalizeProjectId(projectId);
  const existing = await store.get(key, field);
  if (existing) {
    // Finished customer plans keep their approved requirements. Unfinished
    // legacy interviews adopt the new path without throwing away saved answers.
    if (existing.mode !== 'addon' && existing.version < BRIEF_VERSION && !briefProgress(existing).ready) {
      existing.version = BRIEF_VERSION;
      existing.updated_at = Date.now();
      existing.status = briefProgress(existing).ready ? 'ready' : 'interviewing';
      await store.set(key, field, existing);
    }
    return existing;
  }
  const brief = createProjectBrief({ ownerUsername, projectId: field, mode });
  await store.set(key, field, brief);
  return brief;
}

export async function saveBriefAnswer({ ownerUsername, projectId = 'default', mode = 'new', questionId, values, comment, store = createRedisBriefStore() } = {}) {
  const brief = await ensureProjectBrief({ ownerUsername, projectId, mode, store });
  answerProjectBrief(brief, { questionId, values, comment });
  await store.set(briefKey(ownerUsername, mode), brief.project_id, brief);
  return brief;
}

const ADDITION_KINDS = Object.freeze(new Set(['page', 'tool', 'intelligence']));

// The Add a piece entry screen is a planner control, not a chat turn. Keep its
// choice on the durable brief so the builder and the saved stack item agree on
// what is being added without manufacturing an answer to the first question.
export async function saveBriefAdditionKind({ ownerUsername, projectId = 'default', additionKind, store = createRedisBriefStore() } = {}) {
  const kind = cleanText(additionKind, 40).toLowerCase();
  if (!ADDITION_KINDS.has(kind)) throw new Error('Choose a page, tool, or intelligence.');
  const brief = await ensureProjectBrief({ ownerUsername, projectId, mode: 'addon', store });
  brief.addition_kind = kind;
  delete brief.approved_at;
  brief.updated_at = Date.now();
  await store.set(briefKey(ownerUsername, 'addon'), brief.project_id, brief);
  return brief;
}

export async function resetProjectBrief({ ownerUsername, projectId = 'default', mode = 'new', store = createRedisBriefStore() } = {}) {
  const id = normalizeProjectId(projectId);
  await store.delete(briefKey(ownerUsername, mode), id);
  return ensureProjectBrief({ ownerUsername, projectId: id, mode, store });
}

function labelFor(question, value) {
  const found = question.options?.find((option) => option.value === value);
  return found?.label || value;
}

export function publicProjectBrief(brief) {
  const questions = questionsFor(brief);
  const progress = briefProgress(brief);
  const nextQuestion = nextBriefQuestion(brief);
  const summary = questions
    .filter((question) => brief.answers?.[question.field] !== undefined)
    .map((question) => {
      const raw = brief.answers[question.field];
      const values = Array.isArray(raw) ? raw : [raw];
      return {
        field: question.field,
        label: question.question,
        value: values.map((value) => labelFor(question, value)).join(', '),
        comment: brief.comments?.[question.field] || '',
      };
    });
  if (brief.mode === 'addon' && ADDITION_KINDS.has(brief.addition_kind)) {
    const labels = { page: 'Supporting page', tool: 'Tool or workflow', intelligence: 'Intelligence' };
    summary.unshift({ field: 'addition_kind', label: 'What kind of piece is this?', value: labels[brief.addition_kind], comment: '' });
  }
  if (brief.version >= 2 && brief.mode !== 'addon' && brief.answers?.primary_goals) {
    const goals = BASE_QUESTIONS[2];
    const values = Array.isArray(brief.answers.primary_goals) ? brief.answers.primary_goals : [brief.answers.primary_goals];
    summary.push({ field: goals.field, label: goals.question, value: values.map(value => labelFor(goals, value)).join(', '), comment: brief.comments?.primary_goals || '' });
  }
  if (brief.version >= 2 && brief.mode !== 'addon' && !questions.some(question => question.id === 'audience')) {
    summary.splice(2, 0, { field: 'audience', label: 'Who is this mainly for?', value: 'Just me (from your description)', comment: '' });
  }
  return {
    version: brief.version,
    mode: brief.mode || 'new',
    addition_kind: ADDITION_KINDS.has(brief.addition_kind) ? brief.addition_kind : null,
    approved_at: brief.approved_at || null,
    project_id: brief.project_id,
    status: progress.ready ? 'ready' : brief.status,
    answers: brief.answers,
    comments: brief.comments,
    progress,
    next_question: nextQuestion,
    summary,
    updated_at: brief.updated_at,
  };
}

export function compileBriefForModel(brief) {
  if (!brief) return '';
  const publicBrief = publicProjectBrief(brief);
  if (!publicBrief.progress.ready) return '';
  return publicBrief.summary.map((item) => {
    const note = item.comment ? ` — customer note: ${item.comment}` : '';
    return `- ${item.label}: ${item.value}${note}`;
  }).join('\n');
}

export const __briefInternals = { questionsFor, normalizeOwner, normalizeProjectId, cleanValues };

export async function approveProjectBrief({ ownerUsername, projectId = 'default', mode = 'new', store = createRedisBriefStore() } = {}) {
  const brief = await getProjectBrief({ ownerUsername, projectId, mode, store });
  if (!brief || !briefProgress(brief).ready) throw new Error('Complete the plan before approving it.');
  brief.approved_at = Date.now();
  await store.set(briefKey(ownerUsername, mode), brief.project_id, brief);
  return brief;
}

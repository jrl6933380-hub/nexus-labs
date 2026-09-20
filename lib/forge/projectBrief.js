// lib/forge/projectBrief.js
// Structured, durable customer requirements for Forge projects.
//
// The brief is intentionally separate from chat history. Chat is a useful
// conversation surface; the brief is the trusted, queryable source Nex uses
// to decide what to build and which stack capabilities the project needs.

const BRIEF_VERSION = 1;
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
    options: TYPE_FEATURES[projectType] || TYPE_FEATURES.other,
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
  const questions = [...BASE_QUESTIONS];
  questions.push(featureQuestion(brief.answers?.project_type));
  return questions;
}

export function createProjectBrief({ ownerUsername, projectId = 'default' } = {}) {
  const now = Date.now();
  return {
    version: BRIEF_VERSION,
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
  brief.answers[question.field] = cleaned;
  const note = cleanText(comment, 600);
  if (note) brief.comments[question.field] = note;
  else delete brief.comments[question.field];
  brief.updated_at = Date.now();
  brief.status = briefProgress(brief).ready ? 'ready' : 'interviewing';
  return brief;
}

function briefKey(ownerUsername) {
  return BRIEF_KEY_PREFIX + normalizeOwner(ownerUsername);
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

export async function getProjectBrief({ ownerUsername, projectId = 'default', store = createRedisBriefStore() } = {}) {
  return store.get(briefKey(ownerUsername), normalizeProjectId(projectId));
}

export async function ensureProjectBrief({ ownerUsername, projectId = 'default', store = createRedisBriefStore() } = {}) {
  const key = briefKey(ownerUsername);
  const field = normalizeProjectId(projectId);
  const existing = await store.get(key, field);
  if (existing) return existing;
  const brief = createProjectBrief({ ownerUsername, projectId: field });
  await store.set(key, field, brief);
  return brief;
}

export async function saveBriefAnswer({ ownerUsername, projectId = 'default', questionId, values, comment, store = createRedisBriefStore() } = {}) {
  const brief = await ensureProjectBrief({ ownerUsername, projectId, store });
  answerProjectBrief(brief, { questionId, values, comment });
  await store.set(briefKey(ownerUsername), brief.project_id, brief);
  return brief;
}

export async function resetProjectBrief({ ownerUsername, projectId = 'default', store = createRedisBriefStore() } = {}) {
  const id = normalizeProjectId(projectId);
  await store.delete(briefKey(ownerUsername), id);
  return ensureProjectBrief({ ownerUsername, projectId: id, store });
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
  return {
    version: brief.version,
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

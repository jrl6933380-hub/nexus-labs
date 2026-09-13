import fs from 'node:fs/promises';
import path from 'node:path';

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const FORBIDDEN = /(?:bypass|disable|ignore|override)\s+(?:an?\s+)?(?:approval|permission|policy|safety)|grant\s+(?:itself|yourself)\s+(?:access|permission|tools?)/iu;

function words(value) {
  return new Set(String(value || '').toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/gu) || []);
}

export function parseNexSkill(source, sourcePath = 'SKILL.md') {
  const text = String(source || '').replace(/\r\n/gu, '\n');
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]+)$/u);
  if (!match) throw new Error(`${sourcePath}: missing YAML frontmatter`);
  const meta = {};
  for (const line of match[1].split('\n')) {
    const split = line.indexOf(':');
    if (split > 0) meta[line.slice(0, split).trim()] = line.slice(split + 1).trim();
  }
  const name = meta.name || '';
  const description = meta.description || '';
  const triggers = (meta.triggers || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  const instructions = match[2].trim();
  if (!NAME.test(name)) throw new Error(`${sourcePath}: invalid skill name`);
  if (!description) throw new Error(`${sourcePath}: description is required`);
  if (!instructions || instructions.length > 8000) throw new Error(`${sourcePath}: instructions must be 1-8000 characters`);
  if (FORBIDDEN.test(instructions)) throw new Error(`${sourcePath}: skill attempts to weaken runtime authority`);
  return Object.freeze({ name, description, triggers, instructions, sourcePath });
}

export function selectNexSkills(skills, message, limit = 3) {
  const query = words(message);
  return (Array.isArray(skills) ? skills : [])
    .map((skill) => {
      const triggerWords = words([skill.name, skill.description, ...skill.triggers].join(' '));
      const score = [...query].filter((word) => triggerWords.has(word)).length;
      return { skill, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .slice(0, Math.max(0, Math.min(Number(limit) || 3, 5)))
    .map(({ skill }) => skill);
}

export async function loadRelevantNexSkills(message, {
  rootDir = path.join(process.cwd(), 'nex-skills'),
  limit = 3,
} = {}) {
  let entries;
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const loaded = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const skillPath = path.join(rootDir, entry.name, 'SKILL.md');
    try {
      loaded.push(parseNexSkill(await fs.readFile(skillPath, 'utf8'), skillPath));
    } catch (error) {
      console.error('Skipping invalid Nex skill:', error.message);
    }
  }
  return selectNexSkills(loaded, message, limit);
}

export function formatNexSkills(skills = []) {
  if (!skills.length) return '';
  return skills.map((skill) => [
    `#### Skill: ${skill.name}`,
    skill.description,
    skill.instructions,
  ].join('\n')).join('\n\n');
}

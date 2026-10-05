import { listAllNexSkills } from '../lib/nexSkills.js';

// Lightweight, read-only listing for the Skills panel (public/mission-control.html).
// Strips instructions before responding -- the browser only needs
// name/description/triggers to render the list and let Justin pick
// one to force; the actual instructions still only ever reach Nex
// through the normal chat path, never exposed here.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const skills = await listAllNexSkills();
    res.status(200).json({
      skills: skills.map(({ name, description, triggers }) => ({ name, description, triggers })),
    });
  } catch (error) {
    console.error('GET /api/skills failed:', error.message);
    res.status(500).json({ error: 'Could not load skills.' });
  }
}

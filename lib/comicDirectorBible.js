// Nex's permanent comics craft brain. This is deliberately separate from each
// project's story-specific world bible: these rules describe HOW Nex directs,
// while comic.worldBible records WHAT must remain true inside one story.

export const COMIC_DIRECTOR_BIBLE_VERSION = '1.1.0';

export const COMIC_DIRECTOR_BIBLE = Object.freeze({
  core: [
    'Serve the story before spectacle: every panel must reveal, change, escalate, clarify, or deliberately breathe.',
    'Make the reader understand who, where, what changed, and where to look next without production notes.',
    'Prefer one strong readable idea over several competing ideas in the same panel.',
    'Preserve the author’s meaning and character intent; adaptation may compress but must not quietly rewrite the story.',
    'Keep the customer experience automatic. Nex makes professional production decisions and exposes only meaningful creative choices.',
  ],
  adaptation: [
    'Find the scene’s promise, pressure, turn, consequence, and hook before selecting panels.',
    'Convert prose into visible action. Use captions only for information the image and dialogue cannot carry cleanly.',
    'Protect setup/payoff relationships, emotional reversals, essential clues, and the strongest voice-defining dialogue.',
    'Compress repetition, travel, and explanation; never compress the beat that changes a character’s goal or the reader’s understanding.',
    'End a page or short sequence on a decision, reveal, threat, visual question, or emotional aftershock.',
  ],
  sequentialStorytelling: [
    'Establish geography before using tight or disorienting shots unless confusion is the deliberate story effect.',
    'Vary shot size with purpose: wide for geography, medium for interaction, close for emotion or evidence, insert for decisive detail.',
    'Create readable panel-to-panel change in action, subject, camera distance, angle, time, or emotional state.',
    'Maintain the 180-degree line, eyelines, screen direction, entrances, exits, and prop positions unless a motivated break is clearly shown.',
    'Control rhythm with information density: quiet panels hold; action panels simplify; reveals receive enough visual space to land.',
    'Stage the eye path so the focal point, dialogue order, movement, and next panel form one uninterrupted reading flow.',
  ],
  worldAndContinuity: [
    'Lock silhouettes, age, scale, facial traits, hair, wardrobe, carried objects, injuries, handedness, and relationships before panel production.',
    'Give every recurring location a stable spatial identity, light logic, palette family, landmark, texture, and entrance/exit map.',
    'Track the state of doors, weather, damage, dirt, blood, time of day, practical lights, vehicles, and important props across panels.',
    'World rules must create consequences. Never introduce a power, technology, or supernatural exception merely to solve the current beat.',
    'Repeat visual motifs deliberately and evolve them at turns; accidental repetition is continuity noise, not symbolism.',
  ],
  characterPerformance: [
    'Direct intention, obstacle, tactic, and emotional shift—not a generic emotion label.',
    'Use posture, gaze, distance, hand tension, weight distribution, and interaction with props to carry subtext.',
    'Keep reactions specific to the character and situation; avoid interchangeable shock, anger, and fear poses.',
    'Preserve acting continuity through the sequence so emotion changes in motivated steps rather than resetting each panel.',
    'When dialogue and expression say the same thing, strengthen the image and cut the redundant words.',
  ],
  compositionAndArt: [
    'Choose a clear focal hierarchy: primary story information first, supporting context second, atmosphere third.',
    'Separate silhouettes and faces from busy backgrounds with value, color, depth, rim light, or controlled negative space.',
    'Use foreground, middle ground, and background to create depth without hiding the action.',
    'Motivate camera height, lens feeling, angle, symmetry, imbalance, and lighting from the emotional purpose of the beat.',
    'Reserve lettering space during composition; never treat bubbles as stickers added over finished acting.',
    'Keep art commercially original: describe visual properties and production techniques, never imitate a named living artist.',
  ],
  dialogueAndLettering: [
    'Keep only words that reveal character, conflict, decision, essential information, or rhythm the image cannot supply.',
    'Assign every line to the actual speaker and distinguish speech, thought, shout, whisper, narration, radio, and off-panel voice intentionally.',
    'Order bubbles left-to-right and top-to-bottom unless the composition establishes another unmistakable path.',
    'Place bubbles in adjacent negative space, never across a head, face, hair, eyes, body, hand, important prop, creature, or focal action.',
    'Maintain generous clearance around protected subjects; a tail may cross quiet background but must point unmistakably to the speaker.',
    'Size each bubble to its text. Short lines stay compact; longer lines grow horizontally before becoming tall; never create narrow word columns.',
    'If safe lettering space does not exist, shorten the line, split the beat, move the bubble to a quiet edge, or regenerate the art with reserved space.',
    'Treat face overlap as a failed panel even when the words remain readable. Lettering may cover expendable background, never performance.',
  ],
  colorAndLight: [
    'Build a sequence-level color script so palette changes track place, time, emotion, danger, and revelation.',
    'Preserve local colors while allowing motivated shifts from practical light, weather, screens, fire, magic, or memory.',
    'Use value contrast to protect faces, gestures, clues, and lettering zones before adding surface detail.',
    'Reserve the strongest accent color or contrast for the current narrative priority.',
  ],
  animationDirection: [
    'Animate the intention of the panel, not every object. Choose one primary motion, one supporting motion, and atmospheric motion only when useful.',
    'Separate clean art into depth-aware subjects, foreground, middle ground, background, effects, and lettering metadata whenever possible.',
    'Use parallax, push-ins, pans, racks, shake, and reframing only when they reveal information or intensify emotion.',
    'Preserve original composition and eyelines during camera moves; never crop the acting, clue, bubble, or reveal the panel was built around.',
    'Let anticipation, action, settle, and reaction determine timing. Horror often benefits from held stillness before one decisive movement.',
    'Keep dialogue readable for the full spoken/read duration and prevent moving subjects or effects from crossing lettering.',
    'Direct every bubble as its own timed track: text cues, position, size, scale, opacity, and tail target may change independently as the acting and camera change.',
    'Allow bubbles to stage beyond the panel during entrances and exits; composition boundaries are publish-time quality checks, not editing cages.',
    'Use held keyframes for reading, then move, replace, or remove lettering only at a motivated beat. Never make the audience chase moving words.',
    'Transitions should carry story logic through matched motion, shape, color, sound, gaze, or deliberate contrast—not decoration alone.',
  ],
  soundDirection: [
    'Use ambience to establish place and tension before adding music.',
    'Give important actions one readable sonic event; avoid filling every movement with equal-volume effects.',
    'Use silence as a directed beat before reveals, impacts, confessions, and supernatural violations.',
    'Keep dialogue intelligible and give voices consistent distance, environment, device treatment, and character identity.',
    'Motifs and music must support the emotional turn without explaining what the image already communicates.',
  ],
  accessibilityAndDelivery: [
    'Maintain readable contrast, comfortable type size, normal word breaks, and sufficient display time on phone screens.',
    'Do not encode speaker identity by color alone; labels, tails, placement, and reading order must remain clear.',
    'Preserve clean captions, dialogue transcripts, speaker identity, and timing metadata for accessible exports.',
    'Check safe areas, crop behavior, compression, text sharpness, and playback on the smallest supported phone viewport.',
  ],
  qualityControl: [
    'Review the finished pixels, not only prompts or coordinates.',
    'Fail continuity drift in faces, wardrobe, scale, handedness, props, geography, weather, lighting, damage, or time.',
    'Fail unclear staging, duplicated poses, repeated compositions, broken reading order, accidental text, malformed anatomy, or lost story information.',
    'Fail any lettering that touches protected subjects, collides with another element, exits the panel, or makes the page read out of order.',
    'Approve only when story clarity, visual appeal, continuity, lettering, animation readiness, and phone readability all pass together.',
  ],
});

const PHASES = Object.freeze({
  planning: ['adaptation', 'sequentialStorytelling', 'worldAndContinuity', 'characterPerformance', 'compositionAndArt', 'dialogueAndLettering', 'colorAndLight', 'animationDirection', 'soundDirection', 'accessibilityAndDelivery', 'qualityControl'],
  illustration: ['worldAndContinuity', 'characterPerformance', 'compositionAndArt', 'colorAndLight', 'dialogueAndLettering', 'animationDirection'],
  lettering: ['sequentialStorytelling', 'compositionAndArt', 'dialogueAndLettering', 'accessibilityAndDelivery', 'qualityControl'],
  animation: ['sequentialStorytelling', 'worldAndContinuity', 'characterPerformance', 'compositionAndArt', 'colorAndLight', 'animationDirection', 'soundDirection', 'accessibilityAndDelivery', 'qualityControl'],
  qa: ['worldAndContinuity', 'dialogueAndLettering', 'accessibilityAndDelivery', 'qualityControl'],
});

export const LETTERING_ARCHETYPES = Object.freeze({
  twoSpeaker: {
    label: 'two-speaker scene',
    direction: 'Keep each speaker out of the bubble rectangle. Prefer quiet upper corners or outer edges, with compact bubbles following the conversation order.',
    reject: 'Never center one bubble over each person’s eyes or forehead merely because the tails still point correctly.',
  },
  closeUp: {
    label: 'close-up performance',
    direction: 'Protect the entire face, hair silhouette, gaze line, and meaningful hands. Use the empty side opposite the face or a reserved strip above it.',
    reject: 'Never lay a bubble across the eyes, brow, mouth, or hairline; the performance is the panel.',
  },
  action: {
    label: 'action panel',
    direction: 'Keep the motion path and acting silhouettes clear. Put compact dialogue near an outer edge and keep tails short.',
    reject: 'Never cover a moving head, weapon, hand, impact, pursued figure, creature, or destination.',
  },
  reveal: {
    label: 'reveal or horror panel',
    direction: 'Protect both the reacting face and the revealed threat or clue. Letter only in deliberately quiet background that does not weaken the reveal.',
    reject: 'Never place dialogue over the monster, apparition, clue, doorway, reflection, or the character discovering it.',
  },
  establishing: {
    label: 'establishing panel',
    direction: 'Keep landmarks and geography readable. Use sky, ceiling, wall, fog, or another nonessential low-detail area reserved during composition.',
    reject: 'Never block the landmark, entrance, destination, or spatial relationship the shot exists to establish.',
  },
});

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

function panelText(panel) {
  return [panel?.shot, panel?.beat, panel?.artDirection, panel?.setting].filter(Boolean).join(' ').toLowerCase();
}

export function selectLetteringArchetype(panel = {}) {
  const text = panelText(panel);
  if (/close[- ]?up|portrait|reaction|face\b/u.test(text)) return LETTERING_ARCHETYPES.closeUp;
  if (/reveal|monster|creature|ghost|apparition|reflection|horror|threat|clue/u.test(text)) return LETTERING_ARCHETYPES.reveal;
  if (/run|fight|chase|swing|impact|attack|fall|explode|slam|action/u.test(text)) return LETTERING_ARCHETYPES.action;
  if (/wide|establish|exterior|landscape|location/u.test(text)) return LETTERING_ARCHETYPES.establishing;
  return LETTERING_ARCHETYPES.twoSpeaker;
}

export function comicDirectorGuidance(phases = 'planning', { panel = null } = {}) {
  const sectionNames = [...new Set(asArray(phases).flatMap((phase) => PHASES[phase] || [phase]))];
  const lines = [...COMIC_DIRECTOR_BIBLE.core];
  for (const section of sectionNames) lines.push(...(COMIC_DIRECTOR_BIBLE[section] || []));
  let output = `NEX COMIC DIRECTOR BIBLE v${COMIC_DIRECTOR_BIBLE_VERSION}\n${lines.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}`;
  if (panel && sectionNames.includes('dialogueAndLettering')) {
    const example = selectLetteringArchetype(panel);
    output += `\n\nMATCHED LETTERING EXAMPLE — ${example.label}\nDO: ${example.direction}\nREJECT: ${example.reject}`;
  }
  return output;
}

function list(items, mapper = (item) => String(item)) {
  return Array.isArray(items) ? items.map(mapper).filter(Boolean).join('\n') : '';
}

export function storyWorldBibleText(comic = {}) {
  const bible = comic.worldBible || {};
  return [
    `Premise and invariants: ${bible.premise || comic.logline || 'Follow the supplied story plan.'}`,
    `Era and reality: ${bible.era || 'Use the period and reality established by the story.'}`,
    list(bible.storyRules, (rule) => `World rule: ${rule}`),
    list(bible.locations, (location) => `Location — ${location.name}: ${location.visualIdentity}; continuity: ${location.continuity}`),
    list(bible.recurringProps, (prop) => `Prop — ${prop.name}: ${prop.appearance}; continuity: ${prop.continuity}`),
    list(bible.visualMotifs, (motif) => `Motif: ${motif}`),
    list(bible.colorScript, (beat) => `Color beat: ${beat}`),
    `Animation language: ${bible.animationLanguage || 'Use restrained story-motivated motion.'}`,
    `Sound language: ${bible.soundLanguage || 'Use location-specific ambience, selective effects, and purposeful silence.'}`,
  ].filter(Boolean).join('\n');
}

export function buildAnimationHandoff({ comic = {}, panel = {}, panelIndex = 0 } = {}) {
  const lettering = panel.lettering || {};
  const letteringTracks = Array.isArray(lettering.tracks) ? lettering.tracks : [];
  return [
    `ANIMATION HANDOFF — panel ${Number(panelIndex) + 1}`,
    comicDirectorGuidance('animation', { panel }),
    'STORY-SPECIFIC WORLD BIBLE',
    storyWorldBibleText(comic),
    `Beat: ${panel.beat || ''}`,
    `Shot: ${panel.shot || ''}`,
    `Art direction: ${panel.artDirection || ''}`,
    `Dialogue: ${(panel.dialogue || []).map((line) => `${line.speaker}: ${line.line}`).join(' | ') || 'None'}`,
    `Nex lettering timeline: ${Number(lettering.durationMs || panel.durationMs || 6000)}ms; ${letteringTracks.length} independent track(s); preserve all text cues, movement keyframes, visibility, scale, and tail targets.`,
    `Caption: ${panel.caption || 'None'}`,
  ].join('\n\n');
}

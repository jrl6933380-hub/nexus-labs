import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMIC_DIRECTOR_BIBLE,
  COMIC_DIRECTOR_BIBLE_VERSION,
  buildAnimationHandoff,
  comicDirectorGuidance,
  selectLetteringArchetype,
  storyWorldBibleText,
} from '../lib/comicDirectorBible.js';

const comic = {
  title:'The Signal',
  logline:'A courier discovers the package is calling her by name.',
  worldBible:{
    premise:'The package can imitate a voice only after hearing it.',
    era:'Near future during one stormy night.',
    storyRules:['The package cannot move by itself.'],
    locations:[{name:'Last train',visualIdentity:'violet emergency lights and wet steel',continuity:'the rear door remains jammed'}],
    recurringProps:[{name:'Package',appearance:'black case with a cyan seam',continuity:'Mara carries it in her right hand'}],
    visualMotifs:['broken signal bars'],
    colorScript:['violet isolation becomes red danger'],
    animationLanguage:'Restrained holds followed by sharp electronic movement.',
    soundLanguage:'Rain, rail hum, clipped radio voices, and sudden silence.',
  },
  panels:[{
    beat:'Mara sees a figure reflected behind her.',
    shot:'extreme close-up reaction in a dark window reflection',
    artDirection:'protect Mara and the reflected threat',
    dialogue:[{speaker:'Package',line:'Mara.'}],
    caption:'The train knew her name.',
  }],
};

test('the permanent bible covers the complete comic-to-animation craft path', () => {
  assert.match(COMIC_DIRECTOR_BIBLE_VERSION,/^\d+\.\d+\.\d+$/);
  for (const discipline of [
    'adaptation',
    'sequentialStorytelling',
    'worldAndContinuity',
    'characterPerformance',
    'compositionAndArt',
    'dialogueAndLettering',
    'colorAndLight',
    'animationDirection',
    'soundDirection',
    'accessibilityAndDelivery',
    'qualityControl',
  ]) {
    assert.ok(COMIC_DIRECTOR_BIBLE[discipline].length >= 4, `${discipline} needs substantive guidance`);
  }
});

test('phase guidance stays focused while carrying Nex core directing rules', () => {
  const lettering = comicDirectorGuidance('lettering',{panel:comic.panels[0]});
  assert.match(lettering,/Serve the story before spectacle/);
  assert.match(lettering,/face overlap as a failed panel/i);
  assert.match(lettering,/MATCHED LETTERING EXAMPLE — close-up performance/);
  assert.match(lettering,/Match balloon scale aggressively/i);
  assert.match(lettering,/professionally lettered pages as layout lessons/i);
  assert.doesNotMatch(lettering,/Use ambience to establish place/);
  const animation = comicDirectorGuidance('animation');
  assert.match(animation,/timed track/i);
  assert.match(animation,/publish-time quality checks/i);
});

test('lettering archetypes turn visual examples into reusable positive and negative direction', () => {
  const closeUp = selectLetteringArchetype({shot:'tight close-up on her eyes'});
  assert.match(closeUp.direction,/Protect the entire face/);
  assert.match(closeUp.reject,/Never lay a bubble across the eyes/);
  const action = selectLetteringArchetype({beat:'They run as the door explodes behind them'});
  assert.equal(action.label,'action panel');
  const reveal = selectLetteringArchetype({beat:'The monster is revealed in the mirror'});
  assert.equal(reveal.label,'reveal or horror panel');
});

test('story-specific world knowledge and animation handoff remain available downstream', () => {
  const world = storyWorldBibleText(comic);
  assert.match(world,/package can imitate a voice only after hearing it/i);
  assert.match(world,/Last train/);
  assert.match(world,/black case with a cyan seam/);
  assert.match(world,/Restrained holds/);
  assert.match(world,/Rain, rail hum/);
  const handoff = buildAnimationHandoff({comic,panel:comic.panels[0],panelIndex:0});
  assert.match(handoff,/ANIMATION HANDOFF — panel 1/);
  assert.match(handoff,/NEX COMIC DIRECTOR BIBLE/);
  assert.match(handoff,/Mara sees a figure reflected behind her/);
  assert.match(handoff,/Package: Mara\./);
  assert.match(handoff,/Nex lettering timeline:/);
});

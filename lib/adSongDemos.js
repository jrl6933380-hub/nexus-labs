// Demo songs and a demo ad for the song synth (lib/adSong.js). The jingle is an original 15 second tune in C major
// (C - Am - F - G), written the way Claude or ChatGPT would write one: plain data. `jingleAd` pairs it with beat- and
// audio-reactive visuals; the envelopes come from the rendered song, so picture and sound share one source.
import { renderSong, songToMono } from './adSong.js';
import { envelopesFromPcm } from './adAudio.js';

const ROOT = [['C2', 'C3'], ['A1', 'A2'], ['F2', 'F3'], ['G1', 'G2']];
// Bass: low root on 1 and 3, octave pop on the "and" of 2 and 4. One bar per chord, 4 bars loop.
const bassNotes = ROOT.flatMap(([low, high], bar) => [
  [bar * 4, low, 0.75], [bar * 4 + 1.5, high, 0.5], [bar * 4 + 2, low, 0.75], [bar * 4 + 3.5, high, 0.4],
]);
const CHORDS = [['C4', 'E4', 'G4'], ['A3', 'C4', 'E4'], ['F3', 'A3', 'C4'], ['G3', 'B3', 'D4']];
const melody = [
  [0, 'E5', 0.5], [0.5, 'E5', 0.5], [1, 'G5', 0.5], [1.5, 'E5', 0.5], [2, 'C5', 1], [3, 'D5', 1],
  [4, 'E5', 0.5], [4.5, 'E5', 0.5], [5, 'A5', 0.5], [5.5, 'E5', 0.5], [6, 'C5', 1], [7, 'E5', 1],
  [8, 'F5', 0.5], [8.5, 'F5', 0.5], [9, 'A5', 0.5], [9.5, 'F5', 0.5], [10, 'C5', 1], [11, 'A4', 1],
  [12, 'G4', 0.5], [12.5, 'B4', 0.5], [13, 'D5', 0.5], [13.5, 'G5', 0.5], [14, 'G5', 2],
];

export const SONG_DEMOS = {
  jingle: {
    name: 'Slice Time jingle',
    bpm: 128,
    bars: 8,
    tracks: [
      { voice: 'pad', notes: CHORDS.map((c, i) => [i * 4, c, 4]), loopBars: 4, vol: 0.55, pan: -0.15 },
      { voice: 'bell', notes: [[0, 'G6', 1.5], [2, 'E6', 1.5], [4, 'A6', 1.5], [6, 'E6', 1.5], [8, 'A6', 1.5], [10, 'F6', 1.5], [12, 'B6', 1.5], [14, 'D6', 1.5]], loopBars: 4, vol: 0.5, pan: 0.35, endBar: 4 },
      { voice: 'kick', pattern: 'x...x...x...x...', startBar: 1, vol: 0.9 },
      { voice: 'hat', pattern: 'o.x.o.x.o.x.o.x.', startBar: 1, vol: 0.55, pan: 0.25 },
      { voice: 'snare', pattern: '....x.......x...', startBar: 2, vol: 0.7 },
      { voice: 'clap', pattern: '....x.......x...', startBar: 4, vol: 0.5, pan: -0.2 },
      { voice: 'bass', notes: bassNotes, loopBars: 4, startBar: 2, vol: 0.75 },
      { voice: 'lead', notes: melody, loopBars: 4, startBar: 2, vol: 0.6, pan: 0.1 },
      { voice: 'pluck', notes: CHORDS.flatMap((c, i) => c.map((n, k) => [i * 4 + 2 + k * 0.25, n, 0.25, 0.6])), loopBars: 4, startBar: 4, vol: 0.4, pan: -0.35 },
    ],
  },
};

const SCENE_SECONDS = 14.5;
/**
 * A landscape ad whose first scene reacts to the jingle. Returns { project, audio } where `audio` is the rendered
 * song (stereo samples) to mux into the MP4 with scripts/export-ad-mp4.mjs --audio.
 */
export function jingleAd({ rate = 20 } = {}) {
  const song = SONG_DEMOS.jingle;
  const audio = renderSong(song);
  const env = envelopesFromPcm(songToMono(audio), audio.sampleRate, { rate, maxSeconds: SCENE_SECONDS });
  const bars = (react, x, color, color2) => ({ shape: 'rect', x, y: 88, w: 2.6, h: 4, origin: 'bottom', color, color2, angle: 0, react, rStretch: 7, count: 6, stepX: 4.2, delay: 0.1, motion: 'fade_in' });
  const project = {
    specVersion: 2, name: 'Jingle demo', mood: 'bold', palette: 'ocean-blue', concept: true,
    platform: { format: 'landscape', lengthSec: 15 },
    scenes: [{
      id: 'jingle', type: 'graphic', duration: SCENE_SECONDS, background: 'gradient',
      params: {
        bpm: song.bpm, beatZoom: 0.02, beatShake: 0.2,
        audioRate: env.rate, audioLow: env.audioLow, audioMid: env.audioMid, audioHigh: env.audioHigh,
        layers: [
          { shape: 'circle', x: 50, y: 42, w: 38, color: 'orange', color2: 'red', angle: 150, blur: 7, blend: 'screen', opacity: 0.5, react: 'low', rScale: 0.22, rOpacity: 0.4 },
          { shape: 'circle', x: 50, y: 42, w: 17, color: 'yellow', color2: 'orange', angle: 90, glow: 2, react: 'low', rScale: 0.4, rGlow: 6 },
          { shape: 'ring', x: 50, y: 42, w: 30, thickness: 0.6, color: 'white', opacity: 0.5, react: 'beat', rScale: 0.3, rOpacity: -0.35 },
          { shape: 'star', x: 18, y: 30, w: 6, color: 'yellow', glow: 2, react: 'high', rRot: 40, rScale: 0.7, count: 3, stepX: 5, stepY: 10 },
          { shape: 'star', x: 82, y: 30, w: 6, color: 'pink', glow: 2, react: 'mid', rRot: -40, rScale: 0.7, count: 3, stepX: -5, stepY: 10 },
          bars('low', 7, 'orange', 'red'),
          bars('mid', 38, 'yellow', 'orange'),
          bars('high', 68, 'blue', 'violet'),
          { shape: 'text', x: 50, y: 10, text: 'Slice Time', size: 7, weight: 900, caps: true, color: 'white', stroke: 'black', strokeW: 0.5, shadow: 4, fixed: true, react: 'beat', rScale: 0.05 },
        ],
      },
    }, { id: 'end', type: 'end_card', duration: 1.5, params: { cta: 'Song written as code', tagline: 'Nexus song synth' }, background: 'orbits' }],
  };
  return { project, audio, song };
}

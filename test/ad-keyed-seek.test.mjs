import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the actual embedded key-canvas cache with a decoder whose timestamp
// advances before its pixels. This deterministically reproduces the seek race;
// the browser runner also checks real decoded WebM frames in shuffled order.
const html = readFileSync(new URL('../public/ad-designs/vocabulary-player.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('function makeKeyed('), html.indexOf('/* Footage is a pure function'));
function fixture() {
  const video = { videoWidth: 2, videoHeight: 2, readyState: 4, currentTime: 0, seeking: false, style: {}, pixel: 10 };
  let input, output;
  const ctx = { clearRect() {}, drawImage(v) { input = v.pixel; },
    getImageData() { return { data: new Uint8ClampedArray([input, 0, 0, 255]) }; },
    putImageData(v) { output = v.data[0]; } };
  const makeKeyed = runInNewContext(source + ';makeKeyed', {
    document: { createElement: () => ({ style: {}, dataset: {}, getContext: () => ctx }) },
    keyFrame: data => data,
    ImageData: class { constructor(data) { this.data = data; } },
  });
  const key = makeKeyed({ style: {}, appendChild() {} }, video, {}, true, 2, 2);
  return { key, video, output: () => output };
}
test('pending video seeks never cache a stale picture under the new timestamp', () => {
  const { key, video, output } = fixture();
  assert.equal(key.draw(), true); assert.equal(output(), 10);
  video.currentTime = 1; video.seeking = true; video.pixel = 20;
  assert.equal(key.draw(), false); assert.equal(output(), 10);
  video.seeking = false; video.pixel = 30;
  assert.equal(key.draw(), true); assert.equal(output(), 30);
});
test('capture sync refreshes an eager draw after the decoder catches up at the same timestamp', async () => {
  const { key, video, output } = fixture();
  key.draw();
  video.currentTime = 1; video.pixel = 20; key.draw();
  assert.equal(output(), 20);
  // waitVideos has completed: same requested time, newly decoded pixels.
  video.pixel = 30; await key.sync();
  assert.equal(output(), 30);
});

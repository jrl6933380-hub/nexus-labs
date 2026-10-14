import test from 'node:test';
import assert from 'node:assert/strict';
import {demoContactDetails} from '../lib/publishReadiness.js';
test('displayed and linked demo contacts block publishing, including encoded text',()=>{
 for(const html of ['<p>(515) 555-0123</p>','<a href="tel:555-1234">Call</a>','<p>hello&#64;example.com</p>','<p>Your phone number</p>'])assert.ok(demoContactDetails(html).length,html);
});
test('real contacts and demo data only inside scripts do not block publishing',()=>{
 assert.deepEqual(demoContactDetails('<p>support@nexuslabs.io · (515) 432-6789</p><script>const example="a@example.com";</script>'),[]);
});

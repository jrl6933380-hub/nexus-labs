import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
test('Home swipe update download matches its release manifest and preserves immutable provisioning',async()=>{
 const dir=new URL('../public/downloads/',import.meta.url),apk=await readFile(new URL('nexus-phone-0.3.apk',dir)),m=JSON.parse(await readFile(new URL('nexus-phone-0.3.manifest.json',dir)));
 assert.equal(m.version,'0.3.0');assert.equal(m.version_code,3);assert.equal(m.update_from,'0.2.0');assert.equal(m.package_name,'app.nexus.phone');assert.equal(m.bytes,apk.length);assert.equal(m.sha256,createHash('sha256').update(apk).digest('hex'));assert.match(m.source_commit,/^[a-f0-9]{40}$/);
 const page=await readFile(new URL('../public/phone.html',import.meta.url),'utf8');assert.ok(page.includes('/downloads/nexus-phone-0.3.apk'));assert.match(page,/choose Update:/);assert.ok(page.includes('This QR installs v0.2'));
 const provisioning=JSON.parse(await readFile(new URL('nexus-phone-provisioning.json',dir)));assert.ok(provisioning['android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION'].endsWith('nexus-phone-0.2.apk'));
});

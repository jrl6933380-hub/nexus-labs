import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
test('provisioning payload pins exact installable APK and contains no enrollment credential',async()=>{
 const dir=new URL('../public/downloads/',import.meta.url),bytes=await readFile(new URL('nexus-phone-0.2.apk',dir));
 const p=JSON.parse(await readFile(new URL('nexus-phone-provisioning.json',dir))),m=JSON.parse(await readFile(new URL('nexus-phone-0.2.manifest.json',dir)));
 assert.equal(p['android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME'],'app.nexus.phone/.NexusAdmin');
 assert.equal(p['android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION'],'https://nexus-labs-sigma.vercel.app/downloads/nexus-phone-0.2.apk');
 assert.equal(p['android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_CHECKSUM'],createHash('sha256').update(bytes).digest('base64url'));
 assert.equal(m.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(m.bytes,bytes.length);assert.equal(m.remote_reset,false);assert.equal(Object.keys(p).length,3);
 assert.ok((await readFile(new URL('nexus-phone-provisioning.png',dir))).length>1000);
});

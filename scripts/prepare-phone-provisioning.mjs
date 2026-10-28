import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const apk=new URL('../public/downloads/nexus-phone-0.2.apk',import.meta.url),bytes=await readFile(apk);
const checksum=createHash('sha256').update(bytes).digest();
const payload={
 'android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME':'app.nexus.phone/.NexusAdmin',
 'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION':'https://nexus-labs-sigma.vercel.app/downloads/nexus-phone-0.2.apk',
 'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_CHECKSUM':checksum.toString('base64url'),
};
await writeFile(new URL('../public/downloads/nexus-phone-provisioning.json',import.meta.url),JSON.stringify(payload,null,2)+'\n');
await writeFile(new URL('../public/downloads/nexus-phone-0.2.manifest.json',import.meta.url),JSON.stringify({version:'0.2.0',package_name:'app.nexus.phone',bytes:bytes.length,sha256:checksum.toString('hex'),provisioning:'nexus-phone-provisioning.json',remote_reset:false},null,2)+'\n');
console.log('Provisioning payload generated for APK SHA-256 '+checksum.toString('hex'));

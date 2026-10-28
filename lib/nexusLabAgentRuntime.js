import {getStore} from './store/index.js';
import {createAgentTasks} from './nexusLabAgentTasks.js';
import {readLabMedia} from './nexusLabMedia.js';
import {nexusLabAssets} from './nexusLabAssets.js';
export const nexusLabAgentTasks = createAgentTasks({
  command: async args => {
    const store = getStore();
    if (!store) throw Object.assign(new Error('Lab storage is unavailable.'), {status: 503});
    return store.command(args);
  },
  // Images only: the connected AI has to be able to look at them. 4 MB each keeps the tool result small.
  readMedia: (owner, ids) => readLabMedia(owner, ids, {assets: nexusLabAssets, kinds: ['image'], maxBytes: 4 * 1024 * 1024, maxTotal: 12 * 1024 * 1024}),
});

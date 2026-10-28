import {getStore} from './store/index.js';
import {createAgentTasks} from './nexusLabAgentTasks.js';
export const nexusLabAgentTasks = createAgentTasks({
  command: async args => {
    const store = getStore();
    if (!store) throw Object.assign(new Error('Lab storage is unavailable.'), {status: 503});
    return store.command(args);
  },
});

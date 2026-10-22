import { Actor } from 'apify';
import { runActor } from './runtime.js';
await Actor.main(() => runActor(Actor));

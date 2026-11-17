// Rule 19: runtime server-side mode. POST /api/mode {source:"mock"|"real"};
// GET /api/info returns {source, realAvailable}. Real not configured -> 409.
// Rule 26 (owner, 2026-11-17): the boot mode is sticky. WI_REAL_MODE=1 (or real) in the app .env
// starts the lab in Real when the connection is complete, so a container rebuild cannot silently
// drop the lab back to Mock. Without it the default stays Mock.
import { realConfig } from './realGateway.js';

const boot = /^1$|^real$/i.test(String(process.env.WI_REAL_MODE || '').trim()) && realConfig().ok ? 'real' : 'mock';
let source = boot;
export function getMode() { return source; }
export function setMode(next) { source = next; }
export function realAvailable() { return realConfig().ok; }

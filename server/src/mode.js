// Rule 19: runtime server-side mode. POST /api/mode {source:"mock"|"real"};
// GET /api/info returns {source, realAvailable}. Real not configured -> 409.
import { realConfig } from './realGateway.js';

let source = 'mock';
export function getMode() { return source; }
export function setMode(next) { source = next; }
export function realAvailable() { return realConfig().ok; }

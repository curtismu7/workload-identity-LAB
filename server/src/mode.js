// Rule 19: runtime server-side mode. POST /api/mode {source:"mock"|"real"};
// GET /api/info returns {source, realAvailable}. Real not configured -> 409.
let source = 'mock';
export function getMode() { return source; }
export function setMode(next) { source = next; }
export function realAvailable() {
  return Boolean(process.env.WI_REAL_GATEWAY_URL && process.env.WI_REAL_CLIENT_SECRET);
}

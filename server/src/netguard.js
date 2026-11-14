// Rulebook: zero real outbound calls in mock; self-test. Real mode may call
// only the configured gateway + IdP hosts. Each attempt is tagged with the mode it happened in,
// so a Real run never counts against the Mock zero-outbound proof.
import dns from 'node:dns';
import { getMode } from './mode.js';
const attempts = [];
const origLookup = dns.lookup;
export function install() {
  dns.lookup = function patched(host, ...rest) {
    // A bind address (0.0.0.0/localhost/127.x) is not an outbound call.
    const isBind = ['0.0.0.0', 'localhost', '::1'].includes(host) || /^127\./.test(String(host));
    if (!isBind) attempts.push({ host, at: Date.now(), mode: getMode() });
    return origLookup.call(dns, host, ...rest);
  };
}
export function report() { return attempts.slice(); }
export function assertMockZeroOutbound() {
  const n = attempts.filter(a => a.mode === 'mock').length;
  return { attempts: n, ok: n === 0 };
}

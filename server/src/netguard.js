// Rulebook: zero real outbound calls in mock; self-test. Real mode may call
// only the configured gateway + IdP hosts.
import dns from 'node:dns';
const attempts = [];
const origLookup = dns.lookup;
export function install() {
  dns.lookup = function patched(host, ...rest) {
    // A bind address (0.0.0.0/localhost/127.x) is not an outbound call.
    const isBind = ['0.0.0.0', 'localhost', '::1'].includes(host) || /^127\./.test(String(host));
    if (!isBind) attempts.push({ host, at: Date.now() });
    return origLookup.call(dns, host, ...rest);
  };
}
export function report() { return attempts.slice(); }
export function assertMockZeroOutbound() {
  return { attempts: attempts.length, ok: attempts.length === 0 };
}

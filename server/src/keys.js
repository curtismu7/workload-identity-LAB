// Mock IdP signing keys. RSA keygen only — the rulebook bans EC keygen (SIGABRT
// on CI). The RSA pair is generated at boot for the MOCK issuer; mock-issued
// tokens are always labelled mock in the UI.
import crypto from 'node:crypto';
import { createPublicKey, createPrivateKey } from 'node:crypto';

export const MOCK_ISSUER = 'https://idp.workload-lab.invalid';
export const MOCK_AUDIENCE = 'https://gateway.workload-lab.invalid/federated-agent/mcp';
export const MOCK_AGENT_ID = 'demo-agent-1';
export const MOCK_CLIENT_ID = 'demo-agent-1';

function rsaPair() {
  // RSA keygen is allowed by the rulebook (only the EC curve family is banned)
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { publicKey, privateKey };
}

const { publicKey, privateKey } = rsaPair();

function b64u(buf) { return Buffer.from(buf).toString('base64url'); }

export function jwks() {
  const jwk = publicKey.export({ format: 'jwk' });
  return { keys: [{ kty: jwk.kty, use: 'sig', alg: 'RS256', kid: jwk.kid || 'mock-key-1', n: jwk.n, e: jwk.e }] };
}

export function signJwt(claims, kid = 'mock-key-1') {
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const payload = { iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...claims };
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(input), privateKey);
  return `${input}.${b64u(sig)}`;
}

export function verifyJwt(token, jwksKeys) {
  const [h, p, s] = String(token || '').split('.');
  if (!h || !p || !s) return { ok: false, reason: 'malformed token' };
  let header, payload;
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString());
    payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  } catch { return { ok: false, reason: 'undecodable token' }; }
  const key = (jwksKeys.keys || []).find(k => k.kid === header.kid);
  if (!key) return { ok: false, reason: `no key for kid ${header.kid}` };
  const pub = crypto.createPublicKey({ key, format: 'jwk' });
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), pub, Buffer.from(s, 'base64url'));
  if (!ok) return { ok: false, reason: 'signature verification failed' };
  return { ok: true, header, payload };
}

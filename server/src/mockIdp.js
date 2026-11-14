// Mock identity provider: the caller's "own platform" that vouches for the agent.
// Mirrors the PingFederate setup from the guide: client_credentials, audience =
// the agent app URL, act.sub + client_id required claims, scope claim.
import { MOCK_ISSUER, MOCK_AUDIENCE, MOCK_AGENT_ID, MOCK_CLIENT_ID, signJwt } from './keys.js';

const VALID_SCOPES = ['openid', 'federated:read', 'federated:admin', 'whoami:read'];

export function mintToken({ scope, resource, corrupt }) {
  const claims = {
    iss: MOCK_ISSUER,
    aud: resource || MOCK_AUDIENCE,
    sub: MOCK_AGENT_ID,
    client_id: MOCK_CLIENT_ID,
    act: { sub: MOCK_AGENT_ID },
    scope: (scope || 'openid federated:read whoami:read').split(' ').filter(Boolean),
  };
  let token = signJwt(claims);
  if (corrupt === 'signature') {
    // flip chars in the MIDDLE of the signature: base64url trailing chars carry
    // padding bits, so flipping only the last char can decode to the same bytes.
    const parts = token.split('.');
    const sig = parts[2];
    const mid = Math.floor(sig.length / 2);
    const flip = c => (c === 'A' ? 'B' : 'A');
    parts[2] = sig.slice(0, mid - 1) + flip(sig[mid - 1]) + flip(sig[mid]) + sig.slice(mid + 1);
    token = parts.join('.');
  }
  return { token, claims };
}

export function decodeUnsafe(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString());
    return { ok: true, payload };
  } catch { return { ok: false }; }
}

export const idpMeta = { issuer: MOCK_ISSUER, audience: MOCK_AUDIENCE, validScopes: VALID_SCOPES, clientId: MOCK_CLIENT_ID, agentId: MOCK_AGENT_ID };

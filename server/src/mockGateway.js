// Mock Privilege gateway door: validates the presented workload token the way
// the real gateway does — signature against the registered JWKS, then exact
// issuer/audience match, then required claims — then enforces the agent key's
// grant and answers tools/list or tools/call(whoami).
import { jwks, verifyJwt, MOCK_ISSUER, MOCK_AUDIENCE } from './keys.js';
import { decodeUnsafe } from './mockIdp.js';

const IDENTITY = {
  name: 'demo-federated-agent',
  issuer: MOCK_ISSUER,
  audience: MOCK_AUDIENCE,
  requiredClaims: { 'act.sub': 'demo-agent-1', client_id: 'demo-agent-1' },
};

const GRANT_TOOLS = ['ListIndexTool', 'SearchIndexTool', 'CountTool'];

export function validateWorkloadToken(token) {
  const v = verifyJwt(token, jwks());
  if (!v.ok) return { ok: false, stage: 'signature', detail: v.reason, log: `workload token rejected: ${v.reason}` };
  const c = v.payload;
  if (c.iss !== IDENTITY.issuer) return { ok: false, stage: 'issuer', detail: `iss ${c.iss} != ${IDENTITY.issuer}`, log: `workload token rejected: issuer mismatch` };
  if (c.aud !== IDENTITY.audience) return { ok: false, stage: 'audience', detail: `aud ${c.aud} != ${IDENTITY.audience}`, log: `workload token rejected: audience mismatch` };
  for (const [claim, want] of Object.entries(IDENTITY.requiredClaims)) {
    const got = claim.split('.').reduce((o, k) => (o || {})[k], c);
    if (got !== want) return { ok: false, stage: 'required-claims', detail: `${claim} = ${JSON.stringify(got)} != ${JSON.stringify(want)}`, log: `workload token rejected: required claim ${claim} mismatch` };
  }
  if ((c.exp || 0) * 1000 < Date.now()) return { ok: false, stage: 'lifetime', detail: 'token expired', log: 'workload token rejected: expired' };
  return {
    ok: true,
    claims: c,
    log: `workload token accepted for key ${IDENTITY.name} issuer=${c.iss} subject=${c.sub}`,
  };
}

export function mcpCall(token, body) {
  const v = validateWorkloadToken(token);
  if (!v.ok) return { http: 401, body: { error: 'unauthorized', error_description: v.log, stage: v.stage, detail: v.detail }, log: v.log };
  const method = body?.method;
  if (method === 'tools/list') {
    return { http: 200, body: { jsonrpc: '2.0', id: body.id, result: { tools: GRANT_TOOLS.map(name => ({ name, description: `Mock tool ${name}` })) } }, log: v.log, claims: v.claims };
  }
  if (method === 'tools/call' && body?.params?.name === 'whoami') {
    return { http: 200, body: { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify({ agent: IDENTITY.name, receivedClaims: v.claims, note: 'Pass Agent Token: the backend saw the caller token unchanged' }, null, 2) }] } }, log: v.log + ' + token forwarded to backend', claims: v.claims };
  }
  if (method === 'tools/call') {
    return { http: 403, body: { jsonrpc: '2.0', id: body.id, error: { code: -32600, message: `tool ${body.params.name} not in the agent key's grant` } }, log: `policy denied: ${body.params.name} not granted` };
  }
  return { http: 400, body: { jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32601, message: `method ${method} not supported` } }, log: `unsupported method ${method}` };
}

export const gatewayMeta = { identity: IDENTITY.name, grantTools: GRANT_TOOLS, door: '/federated-agent/mcp', authMode: 'Pass Agent Token' };

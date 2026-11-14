// Mock Privilege gateway door: validates the presented workload token the way
// the real gateway does — signature against the registered JWKS, then exact
// issuer/audience match, then required claims — then enforces the agent key's
// grant and answers tools/list or tools/call(whoami).
// Every call also returns `decisions`: the gateway's checks in order, each with the evidence
// it used, so the page can show what the gateway decided (not just the outcome).
import { jwks, verifyJwt, MOCK_ISSUER, MOCK_AUDIENCE } from './keys.js';

const IDENTITY = {
  name: 'demo-federated-agent',
  issuer: MOCK_ISSUER,
  audience: MOCK_AUDIENCE,
  requiredClaims: { 'act.sub': 'demo-agent-1', client_id: 'demo-agent-1' },
};

const GRANT_TOOLS = ['ListIndexTool', 'SearchIndexTool', 'CountTool'];

// The authentication checks, in the order the gateway runs them.
const CHECKS = [['signature', 'Signature'], ['issuer', 'Issuer'], ['audience', 'Audience'], ['required-claims', 'Required claims'], ['lifetime', 'Lifetime']];
const labelOf = (id) => CHECKS.find(([k]) => k === id)?.[1] ?? id;
const decision = (id, label, outcome, evidence) => ({ id, label, outcome, basis: 'checked', evidence });

export function validateWorkloadToken(token) {
  const checks = [];
  const pass = (id, evidence) => checks.push(decision(id, labelOf(id), 'pass', evidence));
  const reject = (id, detail, log) => {
    checks.push(decision(id, labelOf(id), 'fail', detail));
    const notReached = CHECKS.filter(([k]) => !checks.some(c => c.id === k)).map(([k, label]) => decision(k, label, 'skipped', 'not reached: an earlier check failed'));
    return { ok: false, stage: id, detail, log, checks: [...checks, ...notReached] };
  };

  const v = verifyJwt(token, jwks());
  if (!v.ok) return reject('signature', v.reason, `workload token rejected: ${v.reason}`);
  pass('signature', 'verifies against the registered JWKS');
  const c = v.payload;
  if (c.iss !== IDENTITY.issuer) return reject('issuer', `iss ${c.iss} != ${IDENTITY.issuer}`, 'workload token rejected: issuer mismatch');
  pass('issuer', `iss ${c.iss} is the registered issuer`);
  if (c.aud !== IDENTITY.audience) return reject('audience', `aud ${c.aud} != ${IDENTITY.audience}`, 'workload token rejected: audience mismatch');
  pass('audience', `aud ${c.aud} is this door`);
  const seen = [];
  for (const [claim, want] of Object.entries(IDENTITY.requiredClaims)) {
    const got = claim.split('.').reduce((o, k) => (o || {})[k], c);
    if (got !== want) return reject('required-claims', `${claim} = ${JSON.stringify(got)} != ${JSON.stringify(want)}`, `workload token rejected: required claim ${claim} mismatch`);
    seen.push(`${claim} = ${JSON.stringify(got)}`);
  }
  pass('required-claims', `${seen.join(' and ')} (the agent is pinned by these, not by a secret)`);
  if ((c.exp || 0) * 1000 < Date.now()) return reject('lifetime', 'token expired', 'workload token rejected: expired');
  pass('lifetime', `expires in about ${Math.max(0, Math.round((c.exp * 1000 - Date.now()) / 60000))} minutes`);
  return {
    ok: true,
    claims: c,
    checks,
    log: `workload token accepted for key ${IDENTITY.name} issuer=${c.iss} subject=${c.sub}`,
  };
}

export function mcpCall(token, body) {
  const v = validateWorkloadToken(token);
  if (!v.ok) {
    return {
      http: 401,
      body: { error: 'unauthorized', error_description: v.log, stage: v.stage, detail: v.detail },
      log: v.log,
      decisions: [...v.checks, decision('grant', 'Grant', 'skipped', 'not reached: the token was refused')],
    };
  }
  const method = body?.method;
  if (method === 'tools/list') {
    return {
      http: 200,
      body: { jsonrpc: '2.0', id: body.id, result: { tools: GRANT_TOOLS.map(name => ({ name, description: `Mock tool ${name}` })) } },
      log: v.log, claims: v.claims,
      decisions: [...v.checks, decision('grant', 'Grant', 'pass', `key ${IDENTITY.name} is granted ${GRANT_TOOLS.length} tools on this app: ${GRANT_TOOLS.join(', ')}`)],
    };
  }
  if (method === 'tools/call' && body?.params?.name === 'whoami') {
    return {
      http: 200,
      body: { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify({ agent: IDENTITY.name, receivedClaims: v.claims, note: 'Pass Agent Token: the backend saw the caller token unchanged' }, null, 2) }] } },
      log: v.log + ' + token forwarded to backend', claims: v.claims,
      decisions: [
        ...v.checks,
        decision('grant', 'Grant', 'pass', `whoami is in key ${IDENTITY.name}'s grant`),
        decision('forward', 'Pass Agent Token', 'pass', "the caller's own token was forwarded to the backend unchanged"),
      ],
    };
  }
  if (method === 'tools/call') {
    return {
      http: 403,
      body: { jsonrpc: '2.0', id: body.id, error: { code: -32600, message: `tool ${body.params.name} not in the agent key's grant` } },
      log: `policy denied: ${body.params.name} not granted`,
      decisions: [...v.checks, decision('grant', 'Grant', 'fail', `tool ${body.params.name} is not in key ${IDENTITY.name}'s grant`)],
    };
  }
  return {
    http: 400,
    body: { jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32601, message: `method ${method} not supported` } },
    log: `unsupported method ${method}`,
    decisions: [...v.checks, decision('method', 'Method', 'fail', `${method} is not supported on this door`)],
  };
}

export const gatewayMeta = { identity: IDENTITY.name, grantTools: GRANT_TOOLS, door: '/federated-agent/mcp', authMode: 'Pass Agent Token' };

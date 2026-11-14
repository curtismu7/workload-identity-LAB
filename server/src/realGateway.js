// Real mode (rule 19): the verified live flow (AI-DEMO2 privilege/GATEWAY-WORKLOAD-IDENTITY-SETUP.md)
// run server-side, so the PingFederate client secret and the real token never reach the browser.
//   mint:    POST {pf}/as/token.oauth2  client_credentials, resource=<agent app URL>
//   door:    POST {gateway}/<app>/mcp   Authorization: Bearer <real token>
// Every upstream call goes through callUpstream (rule 23: named errors, no blank 200s).
import { randomBytes } from 'node:crypto';
import { callUpstream } from './upstream.js';
import { decodeUnsafe, corruptSignature } from './mockIdp.js';

export const REAL_VARS = ['WI_REAL_GATEWAY_URL', 'WI_REAL_PF_URL', 'WI_REAL_CLIENT_ID', 'WI_REAL_CLIENT_SECRET'];

// https only, except a loopback http URL (the tests' stand-ins). Returns the URL without a trailing slash.
function cleanBase(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) return null;
  return u.origin + u.pathname.replace(/\/+$/, '');
}

export function realConfig(env = process.env) {
  const missing = REAL_VARS.filter(k => !String(env[k] || '').trim());
  if (missing.length) return { ok: false, missing, invalid: [] };
  const gateway = cleanBase(env.WI_REAL_GATEWAY_URL);
  const pf = cleanBase(env.WI_REAL_PF_URL);
  const invalid = [!gateway && 'WI_REAL_GATEWAY_URL', !pf && 'WI_REAL_PF_URL'].filter(Boolean);
  if (invalid.length) return { ok: false, missing: [], invalid };
  const agentApp = String(env.WI_REAL_AGENT_APP || 'pftoken').trim();
  return {
    ok: true,
    gateway, pf,
    clientId: String(env.WI_REAL_CLIENT_ID).trim(),
    secret: env.WI_REAL_CLIENT_SECRET,
    agentApp,
    rsApp: String(env.WI_REAL_RS_APP || 'pftoken-rs').trim(),
    scopes: String(env.WI_REAL_SCOPES || 'openid opensearch:read whoami:read').trim(),
    audience: `${gateway}/${agentApp}/mcp`,
  };
}

export function realHowTo(cfg) {
  if (cfg.invalid?.length) return `Real mode needs https URLs for ${cfg.invalid.join(', ')} in the app .env`;
  return `Real mode needs ${cfg.missing.join(', ')} in the app .env (see .env.example)`;
}

// Safe to send to the browser: no secret.
export function publicInfo(cfg) {
  return {
    gatewayHost: new URL(cfg.gateway).host,
    pfHost: new URL(cfg.pf).host,
    clientId: cfg.clientId,
    agentApp: cfg.agentApp,
    rsApp: cfg.rsApp,
    scopes: cfg.scopes,
    audience: cfg.audience,
  };
}

// The real token stays on the server; the browser carries an opaque handle.
const held = new Map();
export function holdToken(token) {
  const handle = `wi-held-${randomBytes(8).toString('hex')}`;
  held.set(handle, token);
  if (held.size > 20) held.delete(held.keys().next().value);
  return handle;
}
// A handle becomes the real token; anything else (the garbage-bearer control) goes through as typed.
export const resolveBearer = (bearer) => held.get(bearer) ?? bearer;

export async function mintRealToken(cfg, { scope, corrupt } = {}) {
  const form = new URLSearchParams({ grant_type: 'client_credentials', scope: scope || cfg.scopes });
  // Wrong-audience case: leave out resource=, so PingFederate's DEFAULT token manager answers
  // (wrong aud, no act). That is the mix-up the setup guide warns about; the gateway refuses it.
  if (corrupt !== 'wrong-audience') form.set('resource', cfg.audience);
  const res = await callUpstream(`${cfg.pf}/as/token.oauth2`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.secret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: form,
  }, { timeoutMs: 20000 });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const why = [body.error, body.error_description].filter(Boolean).join(': ') || 'no access_token in the response';
    throw Object.assign(new Error(`PingFederate refused the token request (HTTP ${res.status}): ${why}`), { code: 'idp_refused' });
  }
  let token = body.access_token;
  if (corrupt === 'signature' && token.split('.').length === 3) token = corruptSignature(token);
  const decoded = decodeUnsafe(token);
  return { token, claims: decoded.ok ? decoded.payload : { note: 'opaque token (not a JWT)' }, audience: cfg.audience };
}

const ID_HEADERS = ['x-request-id', 'x-correlation-id', 'x-amzn-trace-id', 'traceparent'];
// The response headers worth showing on the trace panel (an allowlist: nothing else is passed on).
const SHOWN_HEADERS = ['content-type', ...ID_HEADERS, 'www-authenticate', 'mcp-session-id', 'date'];

// A gateway reply is JSON or a Server-Sent-Events stream carrying the JSON-RPC message.
export function parseGatewayBody(contentType, text) {
  const t = String(text || '').trim();
  if (!t) return {};
  const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
  if (/text\/event-stream/i.test(contentType || '') || /^(event|data):/m.test(t)) {
    const datas = t.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).filter(Boolean);
    for (const d of datas.reverse()) { try { const o = asObject(JSON.parse(d)); if (o) return o; } catch { /* next */ } }
    return { raw: t.slice(0, 500) };
  }
  try { return asObject(JSON.parse(t)) || { raw: t.slice(0, 500) }; } catch { return { raw: t.slice(0, 500) }; }
}

export async function callGateway(cfg, appName, bearer, rpc) {
  const url = `${cfg.gateway}/${appName}/mcp`;
  const res = await callUpstream(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${resolveBearer(bearer)}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(rpc),
  }, { timeoutMs: 60000 });
  const body = parseGatewayBody(res.headers.get('content-type'), await res.text());
  const requestId = ID_HEADERS.map(h => res.headers.get(h)).find(Boolean) || null;
  const headers = Object.fromEntries(SHOWN_HEADERS.map(h => [h, res.headers.get(h)]).filter(([, v]) => v));
  const where = `${new URL(cfg.gateway).host}/${appName}/mcp`;
  const refused = res.status >= 400;
  return {
    status: res.status,
    body,
    headers,
    url,
    requestId,
    at: new Date().toISOString(),
    log: `HTTP ${res.status} from ${where}${requestId ? ` (request ${requestId})` : ''}`,
    stage: refused ? (body.error || 'refused') : undefined,
    detail: refused ? (body.error_description || body.message || body.error?.message || undefined) : undefined,
  };
}

// Did the backend see the token we sent? Compares the claims whoami reports with the ones we minted.
// true / false when it can tell, null when whoami's reply has no recognisable claims.
export function passthroughVerdict(bearer, gatewayBody) {
  const sent = decodeUnsafe(resolveBearer(bearer));
  if (!sent.ok) return null;
  let seen;
  try {
    const parsed = JSON.parse(gatewayBody?.result?.content?.[0]?.text);
    seen = parsed?.receivedClaims || parsed?.claims || parsed;
  } catch { return null; }
  if (!seen || typeof seen !== 'object') return null;
  const shared = ['iss', 'sub', 'client_id', 'iat', 'exp', 'jti'].filter(k => k in seen && k in sent.payload);
  if (shared.length < 2) return null;
  return shared.every(k => JSON.stringify(seen[k]) === JSON.stringify(sent.payload[k]));
}

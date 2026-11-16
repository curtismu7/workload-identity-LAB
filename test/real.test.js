// Real mode, proven against local stand-ins for PingFederate and the Privilege gateway
// (loopback http, no real system, no real secret).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import dns from 'node:dns';
import { createApp } from '../server/src/app.js';
import { parseGatewayBody, passthroughVerdict, holdToken, realConfig } from '../server/src/realGateway.js';
import { report as netguardReport, assertMockZeroOutbound } from '../server/src/netguard.js';

const SECRET = 'fake-client-secret-DO-NOT-LEAK';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const SIG = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v';
const fakeJwt = (claims) => `${b64u({ alg: 'RS256', typ: 'JWT', kid: 'fake' })}.${b64u(claims)}.${SIG}`;
const listen = (handler) => new Promise(r => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => r(s)); });
const readBody = (req) => new Promise(r => { let d = ''; req.on('data', c => { d += c; }); req.on('end', () => r(d)); });
const url = (s) => `http://127.0.0.1:${s.address().port}`;

const ENV_KEYS = ['WI_REAL_GATEWAY_URL', 'WI_REAL_PF_URL', 'WI_REAL_CLIENT_ID', 'WI_REAL_CLIENT_SECRET'];
const clearEnv = () => ENV_KEYS.forEach(k => delete process.env[k]);

async function withReal(fn, { pfReply } = {}) {
  const seen = { pf: [], gw: [] };
  const baseClaims = { iss: 'https://fake-pf.test', sub: 'pf-client', client_id: 'pf-client', act: { sub: 'agent-1' }, scope: 'openid whoami:read', iat: 1700000000, exp: 1700003600 };
  const pf = await listen(async (req, res) => {
    const form = new URLSearchParams(await readBody(req));
    const entry = { auth: req.headers.authorization, form: Object.fromEntries(form) };
    seen.pf.push(entry);
    res.writeHead(pfReply ? pfReply.status : 200, { 'content-type': 'application/json' });
    if (pfReply) return res.end(JSON.stringify(pfReply.body));
    // No resource= -> PingFederate's DEFAULT token manager answers: an opaque reference token
    entry.token = form.has('resource') ? fakeJwt({ ...baseClaims, aud: form.get('resource') }) : 'opaque-reference-token';
    return res.end(JSON.stringify({ access_token: entry.token, token_type: 'Bearer' }));
  });
  const gw = await listen(async (req, res) => {
    const rpc = JSON.parse((await readBody(req)) || '{}');
    const auth = req.headers.authorization || '';
    seen.gw.push({ url: req.url, auth, rpc });
    const minted = seen.pf.at(-1)?.token;
    // Only a real JWT that this fake PingFederate minted gets in (an opaque reference token never does)
    if (!minted || minted.split('.').length !== 3 || auth !== `Bearer ${minted}`) {
      res.writeHead(401, { 'content-type': 'application/json', 'x-request-id': 'req-401' });
      return res.end(JSON.stringify({ error: 'token_not_found' }));
    }
    if (req.url === '/pftoken/mcp') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': 'req-200' });
      return res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { tools: [{ name: 'ListIndexTool' }, { name: 'CountTool' }] } })}\n\n`);
    }
    if (req.url === '/pftoken-rs/mcp') {
      const payload = JSON.parse(Buffer.from(minted.split('.')[1], 'base64url').toString());
      res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'req-200' });
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } }));
    }
    res.writeHead(404); return res.end('{}');
  });
  Object.assign(process.env, {
    WI_REAL_GATEWAY_URL: url(gw), WI_REAL_PF_URL: url(pf), WI_REAL_CLIENT_ID: 'pf-client', WI_REAL_CLIENT_SECRET: SECRET,
  });
  const srv = createApp().listen(0);
  await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = async (path, body, headers = {}) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json() };
  };
  try {
    await post('/api/mode', { source: 'real' });
    await fn({ post, seen, gwUrl: url(gw), pfUrl: url(pf) });
  } finally {
    await post('/api/mode', { source: 'mock' });
    srv.close(); pf.close(); gw.close(); clearEnv();
  }
}

const LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
const WHOAMI = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'whoami', arguments: {} } };

test('real mode refuses to switch on, and names every missing variable', async () => {
  clearEnv();
  const srv = createApp().listen(0);
  await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const r = await fetch(base + '/api/mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'real' }) });
    assert.equal(r.status, 409);
    const j = await r.json();
    for (const k of ENV_KEYS) assert.match(j.message, new RegExp(k));
    const info = await (await fetch(base + '/api/info')).json();
    assert.equal(info.realAvailable, false);
    assert.deepEqual(info.realMissing.sort(), [...ENV_KEYS].sort());
    assert.equal(info.simulated, true);
  } finally { srv.close(); }
});

test('real config rejects a non-https gateway URL', () => {
  const cfg = realConfig({ WI_REAL_GATEWAY_URL: 'http://gateway.example.com', WI_REAL_PF_URL: 'https://pf.example.com', WI_REAL_CLIENT_ID: 'c', WI_REAL_CLIENT_SECRET: 's' });
  assert.equal(cfg.ok, false);
  assert.deepEqual(cfg.invalid, ['WI_REAL_GATEWAY_URL']);
});

test('real config asks for client-credentials scopes only: PingFederate refuses openid for such a client (invalid_scope)', () => {
  const base = { WI_REAL_GATEWAY_URL: 'https://gateway.example.com', WI_REAL_PF_URL: 'https://pf.example.com', WI_REAL_CLIENT_ID: 'c', WI_REAL_CLIENT_SECRET: 's' };
  assert.equal(realConfig(base).scopes, 'opensearch:read whoami:read');
  assert.equal(realConfig({ ...base, WI_REAL_SCOPES: 'mcp whoami:read' }).scopes, 'mcp whoami:read'); // WI_REAL_SCOPES still overrides
});

test('real flow: mint -> tools/list -> whoami passthrough -> garbage control', async () => {
  await withReal(async ({ post, seen, gwUrl }) => {
    const mint = await post('/api/idp/token', { scope: 'openid whoami:read' });
    assert.equal(mint.status, 200);
    assert.equal(mint.json.held, true);
    assert.match(mint.json.token, /^wi-held-/);
    assert.equal(mint.json.claims.iss, 'https://fake-pf.test');
    assert.equal(mint.json.claims.aud, `${gwUrl}/pftoken/mcp`);

    // PingFederate got the client credentials, the scope and resource=<agent app URL>
    const pfReq = seen.pf[0];
    assert.equal(pfReq.auth, `Basic ${Buffer.from(`pf-client:${SECRET}`).toString('base64')}`);
    assert.equal(pfReq.form.grant_type, 'client_credentials');
    assert.equal(pfReq.form.scope, 'openid whoami:read');
    assert.equal(pfReq.form.resource, `${gwUrl}/pftoken/mcp`);

    // The browser never sees the secret or the real token
    const wire = JSON.stringify(mint.json);
    assert.ok(!wire.includes(SECRET));
    assert.ok(!wire.includes(pfReq.token));

    // tools/list: the gateway receives the REAL token (handle resolved server-side), reply parsed from SSE
    const list = await post('/api/gateway/federated-agent/mcp', LIST, { authorization: `Bearer ${mint.json.token}` });
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.result.tools.map(t => t.name), ['ListIndexTool', 'CountTool']);
    assert.equal(seen.gw[0].auth, `Bearer ${pfReq.token}`);
    assert.equal(seen.gw[0].url, '/pftoken/mcp');
    assert.equal(list.json._meta.source, 'real');
    assert.equal(list.json._meta.requestId, 'req-200');
    assert.match(list.json._meta.log, /HTTP 200 from 127\.0\.0\.1:\d+\/pftoken\/mcp \(request req-200\)/);

    // whoami on the passthrough app: backend saw the same claims
    const who = await post('/api/gateway/federated-rs/mcp', WHOAMI, { authorization: `Bearer ${mint.json.token}` });
    assert.equal(who.status, 200);
    assert.equal(seen.gw[1].url, '/pftoken-rs/mcp');
    assert.equal(who.json._meta.unchanged, true);

    // control: a garbage bearer is forwarded as typed and the gateway refuses it
    const ctl = await post('/api/gateway/federated-agent/mcp', LIST, { authorization: 'Bearer garbage-token-not-real' });
    assert.equal(ctl.status, 401);
    assert.equal(seen.gw[2].auth, 'Bearer garbage-token-not-real');
    assert.equal(ctl.json._meta.stage, 'token_not_found');
  });
});

test('real trace: exact request and response, inferred decisions, and nothing secret', async () => {
  await withReal(async ({ post, seen }) => {
    const mint = await post('/api/idp/token', {});
    const token = seen.pf[0].token;
    const list = await post('/api/gateway/federated-agent/mcp', LIST, { authorization: `Bearer ${mint.json.token}` });
    const t = list.json._meta.trace;
    assert.equal(t.source, 'real');
    assert.match(t.request.url, /\/pftoken\/mcp$/);
    assert.deepEqual(t.request.body, LIST);
    assert.equal(t.request.headers.authorization, `Bearer <PingFederate JWT, ${token.length} characters, kept on the server>`);
    assert.equal(t.response.status, 200);
    assert.equal(t.response.headers['content-type'], 'text/event-stream');
    assert.equal(t.response.headers['x-request-id'], 'req-200');
    assert.deepEqual(t.decisions.map(d => `${d.id}:${d.outcome}:${d.basis}`), ['authenticated:pass:inferred', 'grant:pass:inferred']);
    assert.match(t.decisions[1].evidence, /ListIndexTool, CountTool/);
    assert.match(t.record, /workload token accepted/);
    assert.equal(t.requestId, 'req-200');
    // nothing secret anywhere in what the browser receives
    const wire = JSON.stringify(list.json);
    assert.ok(!wire.includes(SECRET));
    assert.ok(!wire.includes(token));
  });
});

test('real trace: a refused call is an inferred fail that names the log line to look for', async () => {
  await withReal(async ({ post }) => {
    await post('/api/idp/token', {});
    const t = (await post('/api/gateway/federated-agent/mcp', LIST, { authorization: 'Bearer garbage-token-not-real' })).json._meta.trace;
    assert.equal(t.request.headers.authorization, 'Bearer garbage-token-not-real');
    assert.equal(t.response.status, 401);
    assert.equal(t.response.headers['x-request-id'], 'req-401');
    assert.deepEqual(t.decisions.map(d => `${d.id}:${d.outcome}:${d.basis}`), ['authenticated:fail:inferred', 'grant:skipped:inferred']);
    assert.match(t.record, /workload token rejected/);
  });
});

test('real trace: whoami adds an observed Pass Agent Token decision', async () => {
  await withReal(async ({ post }) => {
    const mint = await post('/api/idp/token', {});
    const t = (await post('/api/gateway/federated-rs/mcp', WHOAMI, { authorization: `Bearer ${mint.json.token}` })).json._meta.trace;
    const fwd = t.decisions.find(d => d.id === 'forward');
    assert.equal(fwd.outcome, 'pass');
    assert.equal(fwd.basis, 'observed');
  });
});

test('wrong-audience case leaves out resource=, so the default token manager answers and the gateway refuses', async () => {
  await withReal(async ({ post, seen }) => {
    const mint = await post('/api/idp/token', { corrupt: 'wrong-audience' });
    assert.equal(mint.status, 200);
    assert.ok(!('resource' in seen.pf[0].form));
    assert.equal(mint.json.claims.note, 'opaque token (not a JWT)');
    const gw = await post('/api/gateway/federated-agent/mcp', LIST, { authorization: `Bearer ${mint.json.token}` });
    assert.equal(gw.status, 401);
    assert.equal(gw.json._meta.stage, 'token_not_found');
  });
});

test('signature case changes only the signature and the gateway refuses it', async () => {
  await withReal(async ({ post, seen }) => {
    const mint = await post('/api/idp/token', { corrupt: 'signature' });
    const gw = await post('/api/gateway/federated-agent/mcp', LIST, { authorization: `Bearer ${mint.json.token}` });
    assert.equal(gw.status, 401);
    const [h1, p1, s1] = seen.pf[0].token.split('.');
    const [h2, p2, s2] = seen.gw[0].auth.slice('Bearer '.length).split('.');
    assert.equal(h2, h1);
    assert.equal(p2, p1);
    assert.notEqual(s2, s1);
  });
});

test('PingFederate refusing the request is a named 502 with no secret in it', async () => {
  await withReal(async ({ post }) => {
    const mint = await post('/api/idp/token', {});
    assert.equal(mint.status, 502);
    assert.equal(mint.json.error, 'idp_refused');
    assert.match(mint.json.message, /invalid_target.*did not match any access token manager/);
    assert.ok(!JSON.stringify(mint.json).includes(SECRET));
  }, { pfReply: { status: 400, body: { error: 'invalid_target', error_description: 'did not match any access token manager' } } });
});

test('an unreachable gateway is a named 502, not a blank result', async () => {
  await withReal(async ({ post }) => {
    const mint = await post('/api/idp/token', {});
    // A port that was open a moment ago and is now closed (fetch refuses reserved ports like 1 outright)
    const dead = await listen(() => {});
    process.env.WI_REAL_GATEWAY_URL = url(dead);
    await new Promise(r => dead.close(r));
    const gw = await post('/api/gateway/federated-agent/mcp', LIST, { authorization: `Bearer ${mint.json.token}` });
    assert.equal(gw.status, 502);
    assert.equal(gw.json.error, 'upstream_unreachable');
    assert.equal(gw.json._meta.stage, 'upstream_unreachable');
    // the trace still shows what was sent, with no response and no decision invented
    assert.equal(gw.json._meta.trace.response, null);
    assert.equal(gw.json._meta.trace.decisions[0].id, 'reach');
    assert.equal(gw.json._meta.trace.decisions[0].outcome, 'fail');
  });
});

test('a Real-mode outbound attempt never counts against the Mock zero-outbound proof', async () => {
  await withReal(async () => {
    await new Promise(r => dns.lookup('real-mode-attempt.invalid', () => r()));
  });
  const real = netguardReport().filter(a => a.host === 'real-mode-attempt.invalid');
  assert.equal(real.length, 1);
  assert.equal(real[0].mode, 'real');
  assert.deepEqual(assertMockZeroOutbound(), { attempts: 0, ok: true });
});

test('gateway reply parsing: SSE, plain JSON, and non-JSON', () => {
  assert.deepEqual(parseGatewayBody('text/event-stream', 'event: message\ndata: {"a":1}\n\n'), { a: 1 });
  assert.deepEqual(parseGatewayBody('application/json', '{"b":2}'), { b: 2 });
  assert.deepEqual(parseGatewayBody('text/html', '<html>nope</html>'), { raw: '<html>nope</html>' });
  assert.deepEqual(parseGatewayBody('application/json', ''), {});
});

test('passthrough verdict: same claims true, changed claims false, unrecognisable null', () => {
  const claims = { iss: 'https://x', sub: 's', iat: 1, exp: 2 };
  const handle = holdToken(fakeJwt(claims));
  const reply = (c) => ({ result: { content: [{ type: 'text', text: JSON.stringify(c) }] } });
  assert.equal(passthroughVerdict(handle, reply(claims)), true);
  assert.equal(passthroughVerdict(handle, reply({ ...claims, sub: 'someone-else' })), false);
  assert.equal(passthroughVerdict(handle, reply({ hello: 'world' })), null);
  assert.equal(passthroughVerdict('garbage', reply(claims)), null);
});

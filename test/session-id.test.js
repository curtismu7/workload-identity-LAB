// The Real trace never shows the MCP session id whole: it is a bearer-like handle for that session.
// A loopback stub gateway answers with a LONG fake session id built at run time; nothing real, no network beyond loopback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { createApp } from '../server/src/app.js';
import { stop } from './test-helpers.js';

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const listen = (handler) => new Promise(r => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => r(s)); });
const readBody = (req) => new Promise(r => { let d = ''; req.on('data', c => { d += c; }); req.on('end', () => r(d)); });
const url = (s) => `http://127.0.0.1:${s.address().port}`;
const KEYS = ['WI_REAL_GATEWAY_URL', 'WI_REAL_PF_URL', 'WI_REAL_CLIENT_ID', 'WI_REAL_CLIENT_SECRET'];

async function withStubs(sessionId, fn) {
  const jwt = `${b64u({ alg: 'RS256', typ: 'JWT' })}.${b64u({ iss: 'https://fake-pf.test', sub: 'c', aud: 'x', iat: 1700000000, exp: 1700003600 })}.${randomBytes(24).toString('base64url')}`;
  const pf = await listen(async (req, res) => { await readBody(req); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ access_token: jwt, token_type: 'Bearer' })); });
  const gw = await listen(async (req, res) => {
    const rpc = JSON.parse((await readBody(req)) || '{}');
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': sessionId, 'x-request-id': 'req-1' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { tools: [{ name: 'ListIndexTool' }] } }));
  });
  Object.assign(process.env, { WI_REAL_GATEWAY_URL: url(gw), WI_REAL_PF_URL: url(pf), WI_REAL_CLIENT_ID: 'c', WI_REAL_CLIENT_SECRET: randomBytes(8).toString('hex') });
  const srv = createApp().listen(0);
  await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = async (path, body, headers = {}) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: r.status, text: await r.text() };
  };
  try { await post('/api/mode', { source: 'real' }); await fn(post); }
  finally { await post('/api/mode', { source: 'mock' }); await stop(srv); await stop(pf); await stop(gw); KEYS.forEach(k => delete process.env[k]); }
}

const LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
const call = async (post, headers = {}) => {
  const mint = JSON.parse((await post('/api/idp/token', {})).text);
  return post('/api/gateway/federated-agent/mcp', LIST, { authorization: `Bearer ${mint.token}`, ...headers });
};

test('the Real trace shows the gateway Mcp-Session-Id shortened: first 8 characters, never the whole id', async () => {
  const sid = `sess-${randomBytes(24).toString('hex')}`; // 53 characters, built at run time
  await withStubs(sid, async post => {
    const r = await call(post);
    assert.equal(r.status, 200);
    const trace = JSON.parse(r.text)._meta.trace;
    assert.equal(trace.source, 'real');
    assert.equal(trace.response.headers['mcp-session-id'], `${sid.slice(0, 8)}… (shortened)`);
    assert.ok(!r.text.includes(sid), 'the whole API answer holds no full session id');
    assert.ok(!r.text.includes(sid.slice(0, 9)), 'not even 9 characters of it');
    assert.ok(!JSON.stringify(trace.request.headers).includes(sid));
  });
});

test('a session id the browser sends is not forwarded or shown whole on the request side', async () => {
  const sid = `sess-${randomBytes(24).toString('hex')}`;
  await withStubs(`gw-${randomBytes(24).toString('hex')}`, async post => {
    const r = await call(post, { 'mcp-session-id': sid });
    assert.equal(r.status, 200);
    assert.ok(!r.text.includes(sid));
  });
});

test('a Real trace holds no secret and no "checked" decision', async () => {
  const sid = `sess-${randomBytes(24).toString('hex')}`;
  await withStubs(sid, async post => {
    const r = await call(post);
    const body = JSON.parse(r.text);
    const trace = body._meta.trace;
    for (const d of trace.decisions) assert.notEqual(d.basis, 'checked');
    assert.match(trace.request.headers.authorization, /kept on the server/);
    assert.ok(!r.text.includes(process.env.WI_REAL_CLIENT_SECRET));
    assert.ok(!r.text.includes(sid));
  });
});

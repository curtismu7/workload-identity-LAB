// The "what the gateway did" trace, Mock mode: exact request, exact response, the decisions in order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/src/app.js';
import { stop, startVerified } from './test-helpers.js';

async function withServer(fn) {
  const srv = await startVerified(async () => {
    const s = createApp().listen(0);
    await new Promise(r => s.once('listening', r));
    return s;
  });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = async (path, body, headers = {}) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json() };
  };
  try { await fn(post); } finally { await stop(srv); }
}
const LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
const door = (post, token, body = LIST, app = 'federated-agent') => post(`/api/gateway/${app}/mcp`, body, { authorization: `Bearer ${token}` });
const ids = (t) => t.decisions.map(d => `${d.id}:${d.outcome}`);

test('accepted call: the trace has the exact request, the exact response and every check in order', async () => {
  await withServer(async post => {
    const mint = await post('/api/idp/token', {});
    const gw = await door(post, mint.json.token);
    const t = gw.json._meta.trace;
    assert.equal(t.source, 'mock');
    assert.equal(t.request.method, 'POST');
    assert.match(t.request.url, /\/federated-agent\/mcp$/);
    assert.deepEqual(t.request.body, LIST);
    assert.equal(t.response.status, 200);
    assert.equal(t.response.body.result.tools.length, 3);
    assert.deepEqual(ids(t), ['signature:pass', 'issuer:pass', 'audience:pass', 'required-claims:pass', 'lifetime:pass', 'grant:pass']);
    for (const d of t.decisions) { assert.equal(d.basis, 'checked'); assert.ok(d.evidence.length > 10); }
    assert.match(t.record, /workload token accepted for key demo-federated-agent/);
  });
});

test('the Authorization header on the trace is shortened, never the whole token', async () => {
  await withServer(async post => {
    const mint = await post('/api/idp/token', {});
    const t = (await door(post, mint.json.token)).json._meta.trace;
    assert.match(t.request.headers.authorization, /^Bearer eyJ.{17}… \(\d+ characters, shortened\)$/);
    assert.ok(!JSON.stringify(t).includes(mint.json.token));
  });
});

test('a refused token fails at its stage and the later checks are shown as not reached', async () => {
  await withServer(async post => {
    const aud = (await door(post, (await post('/api/idp/token', { corrupt: 'wrong-audience' })).json.token)).json._meta.trace;
    assert.equal(aud.response.status, 401);
    assert.deepEqual(ids(aud), ['signature:pass', 'issuer:pass', 'audience:fail', 'required-claims:skipped', 'lifetime:skipped', 'grant:skipped']);
    assert.match(aud.decisions[2].evidence, /aud .* != /);

    const sig = (await door(post, (await post('/api/idp/token', { corrupt: 'signature' })).json.token)).json._meta.trace;
    assert.deepEqual(ids(sig), ['signature:fail', 'issuer:skipped', 'audience:skipped', 'required-claims:skipped', 'lifetime:skipped', 'grant:skipped']);
  });
});

test('whoami adds the grant and Pass Agent Token decisions', async () => {
  await withServer(async post => {
    const mint = await post('/api/idp/token', {});
    const t = (await door(post, mint.json.token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'whoami', arguments: {} } }, 'federated-rs')).json._meta.trace;
    assert.match(t.request.url, /\/federated-rs\/mcp$/);
    assert.deepEqual(ids(t).slice(-2), ['grant:pass', 'forward:pass']);
    assert.match(t.decisions.at(-1).evidence, /forwarded to the backend unchanged/);
  });
});

test('a garbage bearer is shown as typed; a tool outside the grant fails at the grant', async () => {
  await withServer(async post => {
    const g = (await door(post, 'garbage-token-not-real')).json._meta.trace;
    assert.equal(g.request.headers.authorization, 'Bearer garbage-token-not-real');
    assert.equal(g.decisions[0].outcome, 'fail');

    const mint = await post('/api/idp/token', {});
    const t = (await door(post, mint.json.token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'DeleteIndexTool', arguments: {} } })).json._meta.trace;
    assert.equal(t.response.status, 403);
    assert.equal(t.decisions.at(-1).id, 'grant');
    assert.equal(t.decisions.at(-1).outcome, 'fail');
  });
});

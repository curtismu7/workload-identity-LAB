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
  try { await fn(base); } finally { await stop(srv); }
}
const post = async (base, path, body, headers = {}) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
};

test('health returns demo-health/1', async () => {
  await withServer(async base => {
    const r = await fetch(base + '/api/health');
    const j = await r.json();
    assert.equal(j.contract, 'demo-health/1');
  });
});

test('happy path: mint -> gateway accepts -> tools granted', async () => {
  await withServer(async base => {
    const mint = await post(base, '/api/idp/token', {});
    assert.ok(mint.json.token);
    assert.equal(mint.json.claims.iss, 'https://idp.workload-lab.invalid');
    const gw = await post(base, '/api/gateway/federated-agent/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: `Bearer ${mint.json.token}` });
    assert.equal(gw.status, 200);
    assert.match(gw.json._meta.log, /workload token accepted/);
    const names = gw.json.result.tools.map(t => t.name);
    assert.deepEqual(names.sort(), ['CountTool', 'ListIndexTool', 'SearchIndexTool']);
  });
});

test('garbage bearer is 401', async () => {
  await withServer(async base => {
    const gw = await post(base, '/api/gateway/federated-agent/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: 'Bearer garbage' });
    assert.equal(gw.status, 401);
    assert.equal(gw.json.stage, 'signature');
  });
});

test('wrong audience is 401 at the audience stage', async () => {
  await withServer(async base => {
    const mint = await post(base, '/api/idp/token', { corrupt: 'wrong-audience' });
    assert.equal(mint.json.claims.aud, 'https://other-system.invalid/aud');
    const gw = await post(base, '/api/gateway/federated-agent/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: `Bearer ${mint.json.token}` });
    assert.equal(gw.status, 401);
    assert.equal(gw.json.stage, 'audience');
  });
});

test('corrupted signature is 401 at the signature stage', async () => {
  await withServer(async base => {
    const mint = await post(base, '/api/idp/token', { corrupt: 'signature' });
    const gw = await post(base, '/api/gateway/federated-agent/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: `Bearer ${mint.json.token}` });
    assert.equal(gw.status, 401);
    assert.equal(gw.json.stage, 'signature');
  });
});

test('pass agent token: backend sees the claims unchanged', async () => {
  await withServer(async base => {
    const mint = await post(base, '/api/idp/token', {});
    const w = await post(base, '/api/gateway/federated-rs/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'whoami', arguments: {} } }, { authorization: `Bearer ${mint.json.token}` });
    assert.equal(w.status, 200);
    const reported = JSON.parse(w.json.result.content[0].text);
    assert.equal(reported.receivedClaims.sub, mint.json.claims.sub);
    assert.deepEqual(reported.receivedClaims.act, mint.json.claims.act);
  });
});

test('unguarded tool call is 403 (grant enforcement)', async () => {
  await withServer(async base => {
    const mint = await post(base, '/api/idp/token', {});
    const gw = await post(base, '/api/gateway/federated-agent/mcp', { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'DeleteAllTool', arguments: {} } }, { authorization: `Bearer ${mint.json.token}` });
    assert.equal(gw.status, 403);
    assert.match(gw.json.error.message, /not in the agent key/);
  });
});

test('mode: real refused with 409 when unconfigured; mock stays', async () => {
  await withServer(async base => {
    const r = await post(base, '/api/mode', { source: 'real' });
    assert.equal(r.status, 409);
    const info = await (await fetch(base + '/api/info')).json();
    assert.equal(info.source, 'mock');
  });
});

test('cross-origin write refused', async () => {
  await withServer(async base => {
    const r = await fetch(base + '/api/reset', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: '{}' });
    assert.equal(r.status, 403);
  });
});

test('reset clears runs', async () => {
  await withServer(async base => {
    await post(base, '/api/runs', { step: 'x', ok: true, detail: 'd' });
    const before = await (await fetch(base + '/api/runs')).json();
    assert.ok(before.runs.length >= 1);
    await post(base, '/api/reset', {});
    const after = await (await fetch(base + '/api/runs')).json();
    assert.equal(after.runs.length, 0);
  });
});

test('netguard: mock mode makes zero outbound attempts', async () => {
  await withServer(async base => {
    await post(base, '/api/idp/token', {});
    const ng = await (await fetch(base + '/api/netguard')).json();
    assert.equal(ng.attempts, 0);
    assert.equal(ng.ok, true);
  });
});

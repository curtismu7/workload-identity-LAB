// The dual-path story: the same IdP token through the governed gateway door vs the direct
// backend door, which verifies the token signature only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/src/app.js';
import { stop } from './test-helpers.js';

async function withServer(fn) {
  const app = createApp();
  const srv = app.listen(0);
  await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { await fn(base); } finally { await stop(srv); }
}
const post = async (base, path, body, headers = {}) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
};
const mint = async (base, body = {}) => (await post(base, '/api/idp/token', body)).json;

test('direct door accepts a valid mock token and lists all 5 tools including the two the gateway hides', async () => {
  await withServer(async base => {
    const t = await mint(base, {});
    const d = await post(base, '/api/direct/backend/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: `Bearer ${t.token}` });
    assert.equal(d.status, 200);
    const names = d.json.result.tools.map(x => x.name);
    assert.equal(names.length, 5);
    assert.ok(names.includes('GrantAdminTool') && names.includes('DeleteAllTool'));
  });
});

test('direct door refuses a tampered signature with 401 at the signature stage', async () => {
  await withServer(async base => {
    const t = await mint(base, { corrupt: 'signature' });
    const d = await post(base, '/api/direct/backend/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: `Bearer ${t.token}` });
    assert.equal(d.status, 401);
    assert.equal(d.json.stage, 'signature');
  });
});

test('direct door does NOT enforce the gateway grant: GrantAdminTool call is 200, not 403', async () => {
  await withServer(async base => {
    const t = await mint(base, {});
    const d = await post(base, '/api/direct/backend/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'GrantAdminTool', arguments: {} } }, { authorization: `Bearer ${t.token}` });
    assert.equal(d.status, 200);
    // and the gateway still refuses the very same call
    const g = await post(base, '/api/gateway/federated-agent/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'GrantAdminTool', arguments: {} } }, { authorization: `Bearer ${t.token}` });
    assert.equal(g.status, 403);
  });
});

test('direct door does not enforce audience binding: a wrong-audience token is accepted', async () => {
  await withServer(async base => {
    const t = await mint(base, { corrupt: 'wrong-audience' });
    const d = await post(base, '/api/direct/backend/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: `Bearer ${t.token}` });
    assert.equal(d.status, 200);
    const g = await post(base, '/api/gateway/federated-agent/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { authorization: `Bearer ${t.token}` });
    assert.equal(g.status, 401);
    assert.equal(g.json.stage, 'audience');
  });
});

test('direct whoami reports claims raw, without the gateway unchanged/forwarded semantic', async () => {
  await withServer(async base => {
    const t = await mint(base, {});
    const d = await post(base, '/api/direct/backend/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'whoami', arguments: {} } }, { authorization: `Bearer ${t.token}` });
    assert.equal(d.status, 200);
    const reported = JSON.parse(d.json.result.content[0].text);
    assert.equal(reported.receivedClaims.sub, t.claims.sub);
    assert.deepEqual(reported.receivedClaims.act, t.claims.act);
    assert.equal(d.json._meta.lane, 'direct');
  });
});

test('the runs log distinguishes lane direct vs gateway', async () => {
  await withServer(async base => {
    const t = await mint(base, {});
    const d = await post(base, '/api/direct/backend/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: `Bearer ${t.token}` });
    const g = await post(base, '/api/gateway/federated-agent/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: `Bearer ${t.token}` });
    assert.equal(d.json._meta.lane, 'direct');
    assert.equal(g.json._meta.lane, 'gateway');
  });
});

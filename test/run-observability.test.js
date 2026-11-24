// Run observability (rule 27): the record for one run, the stdout decision lines and the vendored pin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/src/app.js';
import { setMode } from '../server/src/mode.js';
import { setDecisionWriter, recordMint, recordGatewayReply, recordGatewayNoReply, recordFor, clearRuns, hasRun } from '../server/src/runLog.js';
import { assertRunObservability } from '../server/src/runObservability.js';
import { checkPin } from '../scripts/run-observability-checkPin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MATCHER_WORDS = /refused|denied|rejected|forbidden|failed|invalid|expired|mismatch|token|audience|scope|served/i;

function withServer(fn) {
  return new Promise((resolve, reject) => {
    const s = createApp().listen(0, '127.0.0.1', async () => {
      const base = `http://127.0.0.1:${s.address().port}`;
      try { await fn(base); resolve(); } catch (e) { reject(e); } finally { s.close(); }
    });
  });
}

const post = (base, p, body, headers = {}) => fetch(base + p, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const get = (base, p) => fetch(base + p);

// Capture stdout decision lines; a test that does not care about them passes a silent writer.
function captureLines() {
  const lines = [];
  setDecisionWriter((l) => lines.push(l));
  return lines;
}

test('the vendored panel files and the core match the pin', () => {
  assert.deepEqual(checkPin(ROOT), []);
});

test('a Mock run records one simulated row per step and one stdout line per gateway decision', async () => {
  setMode('mock'); clearRuns();
  const lines = captureLines();
  const runId = 'run-test-mock-0001';
  await withServer(async (base) => {
    const H = { 'x-run-id': runId };
    const mint = await post(base, '/api/idp/token', {}, H);
    const tok = (await mint.json()).token;
    const auth = { authorization: `Bearer ${tok}` };
    const gw = await post(base, '/api/gateway/federated-agent/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { ...auth, ...H, 'x-run-step': 'gateway-tools-list' });
    assert.equal(gw.status, 200);
    const w = await post(base, '/api/gateway/federated-rs/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'whoami', arguments: {} } }, { ...auth, ...H, 'x-run-step': 'gateway-passthrough' });
    assert.equal(w.status, 200);
    const c = await post(base, '/api/gateway/federated-agent/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/list' }, { authorization: 'Bearer garbage-token-not-real', ...H, 'x-run-step': 'gateway-control' });
    assert.equal(c.status, 401);

    const r = await get(base, `/api/observability/${runId}`);
    assert.equal(r.status, 200);
    const rec = await r.json();
    assert.deepEqual(assertRunObservability(rec), []);
    assert.equal(rec.source, 'mock');
    assert.equal(rec.runId, runId);
    const gwRows = rec.rows.filter((x) => x.layer === 'gateway');
    assert.deepEqual(gwRows.map((x) => x.outcome), ['allowed', 'allowed', 'info']); // the control's 401 is a credential check, not a refusal
    assert.ok(gwRows.every((x) => x.origin === 'simulated'), 'mock rows are simulated, never logged');
    assert.equal(rec.coverage.gateway, 'simulated');
    assert.equal(rec.coverage.person, 'not-logged');
    assert.equal(rec.coverage.privilege, 'not-logged');
    assert.match(rec.reasons.privilege, /one reply per call/);
    // Issuance is a credential check, never an allow: the mint is an info row
    assert.equal(rec.rows.find((x) => x.layer === 'agent').outcome, 'info');
    // The mock backend's answer to whoami is an info row (not a decision)
    assert.equal(rec.rows.find((x) => x.layer === 'resource').outcome, 'info');
    // One stdout line per gateway decision; the line carries the row's own time
    assert.equal(lines.length, 3);
    lines.forEach((line, i) => assert.ok(line.startsWith(gwRows[i].at), `line ${i} carries the row time`));
    // The run id on the line is shortened (first 4, last 2) because the masker replaces UUID-like ids
    assert.match(lines[0], /step=gateway-tools-list actor=workload-identity-lab result=passed run=run-\.\.01$/);
    assert.match(lines[2], /step=gateway-control actor=workload-identity-lab result=unclear run=run-\.\.01$/);
    lines.forEach((line) => assert.doesNotMatch(line, MATCHER_WORDS, `no matcher word in: ${line}`));
  });
  setDecisionWriter((l) => console.log(l));
});

test('a Mock record is not served in Real mode, and an unknown run is 404 JSON', async () => {
  setMode('mock'); clearRuns();
  setDecisionWriter(() => {});
  recordMint({ runId: 'run-test-mode-0001', mode: 'mock', message: 'issued' });
  await withServer(async (base) => {
    setMode('real');
    const other = await get(base, '/api/observability/run-test-mode-0001');
    assert.equal(other.status, 404);
    assert.equal((await other.json()).error, 'other_mode');
    const none = await get(base, '/api/observability/run-test-none-0001');
    assert.equal(none.status, 404);
    assert.equal((await none.json()).error, 'not_found');
    setMode('mock');
  });
  setDecisionWriter((l) => console.log(l));
});

test('a bad run id is 400 JSON; other methods are 405 with Allow: GET', async () => {
  setMode('mock');
  await withServer(async (base) => {
    const bad = await get(base, '/api/observability/short');
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'bad_run_id');
    const wrong = await post(base, '/api/observability/run-test-mock-0001', {});
    assert.equal(wrong.status, 405);
    assert.equal(wrong.headers.get('allow'), 'GET');
  });
});

test('a run id that is not valid begins no run and writes one run=- decision line', async () => {
  setMode('mock'); clearRuns();
  const lines = captureLines();
  await withServer(async (base) => {
    const gw = await post(base, '/api/gateway/federated-agent/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: 'Bearer garbage-token-not-real', 'x-run-id': 'bad id!!', 'x-run-step': 'gateway-control' });
    assert.equal(gw.status, 401);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /run=-$/);
    assert.equal((await get(base, '/api/observability/bad_id_0000000')).status, 400);
  });
  setDecisionWriter((l) => console.log(l));
});

test('a throwing stdout writer drops only that line: the answers and the record are the same', async () => {
  setMode('mock'); clearRuns();
  let calls = 0;
  setDecisionWriter(() => { calls += 1; if (calls === 2) throw Object.assign(new Error('EPIPE secret-looking text'), { code: 'EPIPE' }); });
  const runId = 'run-test-writer-0001';
  await withServer(async (base) => {
    const H = { 'x-run-id': runId, 'x-run-step': 'gateway-tools-list' };
    const a = await post(base, '/api/gateway/federated-agent/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: 'Bearer garbage-token-not-real', ...H });
    const b = await post(base, '/api/gateway/federated-agent/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: 'Bearer garbage-token-not-real', ...H });
    const c = await post(base, '/api/gateway/federated-agent/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: 'Bearer garbage-token-not-real', ...H });
    assert.deepEqual([a.status, b.status, c.status], [401, 401, 401]);
    const rec = await (await get(base, `/api/observability/${runId}`)).json();
    assert.equal(rec.rows.filter((x) => x.layer === 'gateway').length, 3, 'all three rows kept');
    assert.equal(calls, 3);
  });
  setDecisionWriter((l) => console.log(l));
});

test('a call that got no reply is no row, and its stdout line says no-reply', () => {
  clearRuns();
  const lines = captureLines();
  recordGatewayNoReply({ runId: 'run-test-noreply-1', mode: 'real', step: 'gateway-tools-list' });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /result=no-reply/);
  return recordFor('real', 'run-test-noreply-1').then((rec) => {
    // collectRun adds one not-logged placeholder row for an empty layer; no reply means no lab row
    assert.equal(rec.rows.filter((x) => x.layer === 'gateway' && x.origin !== 'not-logged').length, 0);
    assert.equal(rec.coverage.gateway, 'not-logged');
    assert.deepEqual(assertRunObservability(rec), []);
    setDecisionWriter((l) => console.log(l));
  });
});

test('a Real run is recorded as response rows, never simulated and never logged', async () => {
  clearRuns();
  setDecisionWriter(() => {});
  const runId = 'run-test-real-0001';
  recordMint({ runId, mode: 'real', message: 'PingFederate issued the agent a token' });
  recordGatewayReply({ runId, mode: 'real', step: 'gateway-tools-list', app: 'federated-agent', status: 200, body: { result: { tools: [] } } });
  recordGatewayReply({ runId, mode: 'real', step: 'gateway-passthrough', app: 'federated-rs', status: 403, body: { error: 'forbidden' } });
  recordGatewayReply({ runId, mode: 'real', step: 'gateway-control', app: 'federated-agent', status: 502, body: {} });
  const rec = await recordFor('real', runId);
  assert.deepEqual(assertRunObservability(rec), []);
  assert.equal(rec.source, 'real');
  const lab = rec.rows.filter((x) => x.origin !== 'not-logged');
  assert.ok(lab.every((x) => x.origin === 'response'));
  assert.deepEqual(lab.filter((x) => x.layer === 'gateway').map((x) => x.outcome), ['allowed', 'refused', 'info']);
  assert.equal(rec.coverage.resource, 'not-logged');
  assert.match(rec.reasons.resource, /does not read the MCP backend log/);
  assert.equal(rec.summary.allowed, 1);
  assert.equal(rec.summary.refused, 1);
  setDecisionWriter((l) => console.log(l));
});

test('a 200 that carries a JSON-RPC error is refused, not allowed', async () => {
  clearRuns();
  setDecisionWriter(() => {});
  const runId = 'run-test-rpcerr-1';
  recordGatewayReply({ runId, mode: 'real', step: 'gateway-tools-list', app: 'federated-agent', status: 200, body: { error: { code: -32000, message: 'x' } } });
  const rec = await recordFor('real', runId);
  assert.equal(rec.rows[0].outcome, 'refused');
  setDecisionWriter((l) => console.log(l));
});

test('a gateway 401 is a credential check (info); a 403 is a refusal', () => {
  clearRuns();
  const lines = captureLines();
  const runId = 'run-test-401-0001';
  recordGatewayReply({ runId, mode: 'mock', step: 'gateway-control', app: 'federated-agent', status: 401, body: {} });
  recordGatewayReply({ runId, mode: 'mock', step: 'gateway-passthrough', app: 'federated-rs', status: 403, body: {} });
  setDecisionWriter((l) => console.log(l));
  return recordFor('mock', runId).then((rec) => {
    assert.deepEqual(rec.rows.filter((x) => x.layer === 'gateway').map((x) => x.outcome), ['info', 'refused']);
    assert.match(lines[0], /result=unclear/);
    assert.match(lines[1], /result=stopped/);
  });
});

test('runs that never reach the control step do not fill the kept list: the newest run is kept, the oldest dropped', async () => {
  clearRuns();
  setDecisionWriter(() => {});
  for (let i = 0; i < 21; i += 1) recordMint({ runId: `run-test-cap-${String(i).padStart(4, '0')}`, mode: 'mock', message: 'issued' });
  assert.ok(await recordFor('mock', 'run-test-cap-0020'), 'the newest run is kept');
  assert.equal(await recordFor('mock', 'run-test-cap-0000'), null, 'the oldest run is the one dropped');
  setDecisionWriter((l) => console.log(l));
});

test('a mint that is not configured begins no run and says so in its answer', async () => {
  setMode('real'); clearRuns();
  setDecisionWriter(() => {});
  await withServer(async (base) => {
    const r = await post(base, '/api/idp/token', {}, { 'x-run-id': 'run-test-mint-0001' });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).run_began, false);
    assert.equal(hasRun('real', 'run-test-mint-0001'), false);
  });
  setMode('mock');
  setDecisionWriter((l) => console.log(l));
});

const ROOT_FILES = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? ROOT_FILES(path.join(dir, e.name)) : [path.join(dir, e.name)]));
// The only files that may carry a RUN_OBS_ name: the core (one named exemption) and the vendored panel files that test it. Each is named in CLAUDE.md.
const RUN_OBS_FILES = ['server/src/runObservability.js', 'web/src/run-observability/fixtures.js', 'web/src/run-observability/run-observability.test.jsx'];

test('RUN_OBS_ names appear only in the named vendored files, never in lab code', () => {
  const hits = [...ROOT_FILES(path.join(ROOT, 'server', 'src')), ...ROOT_FILES(path.join(ROOT, 'web', 'src'))]
    .filter((f) => fs.readFileSync(f, 'utf8').includes('RUN_OBS_'))
    .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
    .sort();
  assert.deepEqual(hits, [...RUN_OBS_FILES].sort());
});

test('CLAUDE.md names those exempt files and does not claim there is no RUN_OBS_ name', () => {
  const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  assert.doesNotMatch(claude, /no RUN_OBS_/);
  for (const f of RUN_OBS_FILES) assert.ok(claude.includes(f), `CLAUDE.md names ${f}`);
});

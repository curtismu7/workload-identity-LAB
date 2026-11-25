// The Real button's connect step, against a local stand-in for PingFederate (loopback http, no real system,
// no real secret): it checks the client before saving, saves to the volume with mode 600, and the secret
// is never in any response.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/src/app.js';
import { getMode } from '../server/src/mode.js';
import { forgetConnection } from '../server/src/realStore.js';
import { stop, startVerified } from './test-helpers.js';

const SECRET = 'fake-client-secret-DO-NOT-LEAK';
const ENV_KEYS = ['WI_REAL_GATEWAY_URL', 'WI_REAL_PF_URL', 'WI_REAL_CLIENT_ID', 'WI_REAL_CLIENT_SECRET', 'WI_REAL_MODE'];
const listen = (handler) => new Promise(r => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => r(s)); });
const url = (s) => `http://127.0.0.1:${s.address().port}`;

async function withApp(fn, { configDir } = {}) {
  ENV_KEYS.forEach(k => delete process.env[k]);
  const dir = configDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'wi-connect-'));
  process.env.WI_CONFIG_DIR = dir;
  forgetConnection();
  const seen = [];
  const pf = await listen((req, res) => {
    seen.push({ auth: req.headers.authorization, mode: getMode() }); // the mode while PingFederate is being called
    const ok = req.headers.authorization === `Basic ${Buffer.from(`pf-client:${SECRET}`).toString('base64')}`;
    res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ok ? { access_token: 'opaque-reference-token', token_type: 'Bearer' } : { error: 'invalid_client', error_description: 'bad credentials' }));
  });
  const srv = await startVerified(async () => {
    const s = createApp().listen(0);
    await new Promise(r => s.once('listening', r));
    return s;
  });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = async (p, body) => {
    const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    return { status: r.status, text: await r.text() };
  };
  const json = (r) => JSON.parse(r.text);
  const get = async (p) => { const r = await fetch(base + p); return { status: r.status, text: await r.text() }; };
  const form = (over = {}) => ({ gatewayUrl: 'http://127.0.0.1:9', pfUrl: url(pf), clientId: 'pf-client', clientSecret: SECRET, ...over });
  try {
    await fn({ post, get, json, form, seen, dir, file: path.join(dir, 'real-connection.json') });
  } finally {
    await post('/api/mode', { source: 'mock' });
    forgetConnection();
    await stop(srv); await stop(pf);
    ENV_KEYS.forEach(k => delete process.env[k]);
    delete process.env.WI_CONFIG_DIR;
  }
}

// Rule 26 (owner, 2026-11-17): the boot mode is sticky. WI_REAL_MODE=1 starts the lab in Real when the
// connection is complete; without it (or with the connection incomplete) the lab starts in Mock. These
// drive mode.js's boot read directly, each in a fresh child process so the module-level boot value is honest.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bootSource = (env) => {
  const code = "import('./server/src/mode.js').then(m => console.log(m.getMode()))";
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, ...env }, cwd: path.dirname(fileURLToPath(import.meta.url)) + '/..', encoding: 'utf8' });
  return r.stdout.trim();
};

test('rule 26: WI_REAL_MODE=1 boots Real only when the connection is complete, else Mock', () => {
  const full = { WI_REAL_GATEWAY_URL: 'https://g.example.com', WI_REAL_PF_URL: 'https://pf.example.com', WI_REAL_CLIENT_ID: 'c', WI_REAL_CLIENT_SECRET: 's', WI_CONFIG_DIR: '/dev/null/not-a-directory' };
  assert.equal(bootSource({ ...full, WI_REAL_MODE: '1' }), 'real');
  assert.equal(bootSource({ ...full, WI_REAL_MODE: 'real' }), 'real');
  assert.equal(bootSource({ ...full, WI_REAL_MODE: '' }), 'mock');
  assert.equal(bootSource({ ...full, WI_REAL_MODE: 'true' }), 'mock', 'only 1 or the word real opt in');
  assert.equal(bootSource({ WI_REAL_MODE: '1' }), 'mock', 'no complete connection: Real cannot stick, Mock keeps working');
});

test('connect checks the client at PingFederate, saves it mode 600, and the secret is in no response', async () => {
  await withApp(async ({ post, get, json, form, seen, file }) => {
    const r = await post('/api/real/connect', form());
    assert.equal(r.status, 200);
    assert.equal(json(r).persisted, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].mode, 'real', 'the check is an outbound call: it must be tagged Real, never counted against Mock');
    assert.equal(getMode(), 'mock', 'connecting does not switch the page to Real by itself');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).WI_REAL_CLIENT_SECRET, SECRET);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const info = await get('/api/info');
    for (const text of [r.text, info.text]) assert.ok(!text.includes(SECRET), 'the secret must not appear in a response');
    assert.equal(json(info).realAvailable, true);
    assert.equal(json(info).realSource, 'saved');
    assert.equal(json(info).realForm.clientId, 'pf-client');
    assert.equal(json(info).real.clientId, 'pf-client');
    // The saved connection is what Real mode now uses
    assert.equal((await post('/api/mode', { source: 'real' })).status, 200);
    const t = await post('/api/idp/token', { scope: 'openid' });
    assert.equal(t.status, 200);
    assert.match(json(t).token, /^wi-held-/);
    assert.ok(!t.text.includes(SECRET));
  });
});

test('a client PingFederate refuses is named and nothing is saved', async () => {
  await withApp(async ({ post, get, json, form, file }) => {
    const r = await post('/api/real/connect', form({ clientSecret: 'wrong-secret' }));
    assert.equal(r.status, 401);
    assert.equal(json(r).error, 'idp_refused');
    assert.match(json(r).message, /PingFederate refused.*invalid_client/);
    assert.ok(!r.text.includes('wrong-secret'));
    assert.equal(fs.existsSync(file), false);
    assert.equal(json(await get('/api/info')).realAvailable, false);
    assert.equal(getMode(), 'mock');
  });
});

test('an unreachable PingFederate is named, the mode is put back, and nothing is saved', async () => {
  await withApp(async ({ post, json, form, file }) => {
    const dead = await listen(() => {}); const deadUrl = url(dead); await stop(dead);
    const r = await post('/api/real/connect', form({ pfUrl: deadUrl }));
    assert.equal(r.status, 502);
    assert.match(json(r).message, /unreachable|network error/);
    assert.equal(fs.existsSync(file), false);
    assert.equal(getMode(), 'mock');
  });
});

test('missing fields and non-https URLs are refused before PingFederate is called', async () => {
  await withApp(async ({ post, json, form, seen }) => {
    const noSecret = await post('/api/real/connect', form({ clientSecret: '   ' }));
    assert.equal(noSecret.status, 400);
    assert.match(json(noSecret).message, /client secret/);
    const http_ = await post('/api/real/connect', form({ gatewayUrl: 'http://gateway.example.com' }));
    assert.equal(http_.status, 400);
    assert.match(json(http_).message, /gateway URL must be an https URL/);
    assert.equal(seen.length, 0, 'PingFederate must not be called with a connection that is not valid');
  });
});

test('a pasted secret with trailing whitespace is checked and saved exactly as trimmed', async () => {
  await withApp(async ({ post, form, file }) => {
    const r = await post('/api/real/connect', form({ clientSecret: `${SECRET}\n` }));
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).WI_REAL_CLIENT_SECRET, SECRET);
  });
});

test('forget removes the saved connection and drops back to Mock', async () => {
  await withApp(async ({ post, get, json, form, file }) => {
    await post('/api/real/connect', form());
    await post('/api/mode', { source: 'real' });
    assert.equal(getMode(), 'real');
    const r = await post('/api/real/forget');
    assert.equal(json(r).source, 'mock');
    assert.equal(fs.existsSync(file), false);
    const info = json(await get('/api/info'));
    assert.equal(info.realAvailable, false);
    assert.equal(info.realSource, null);
  });
});

test('if the volume cannot be written the connection works for this run and says so', async () => {
  await withApp(async ({ post, get, json, form }) => {
    const r = await post('/api/real/connect', form());
    assert.equal(r.status, 200);
    assert.equal(json(r).persisted, false);
    const info = json(await get('/api/info'));
    assert.equal(info.realAvailable, true);
    assert.equal(info.realSource, 'memory');
    assert.ok(!r.text.includes(SECRET));
  }, { configDir: '/dev/null/not-a-directory' });
});

test('a saved connection wins over the app .env, and forgetting it falls back to the .env', async () => {
  await withApp(async ({ post, get, json, form, seen }) => {
    Object.assign(process.env, { WI_REAL_GATEWAY_URL: 'https://env-gateway.example.com', WI_REAL_PF_URL: 'https://env-pf.example.com', WI_REAL_CLIENT_ID: 'env-client', WI_REAL_CLIENT_SECRET: 'env-secret' });
    assert.equal(json(await get('/api/info')).realSource, 'env');
    await post('/api/real/connect', form());
    assert.equal(json(await get('/api/info')).realSource, 'saved');
    await post('/api/mode', { source: 'real' });
    assert.equal((await post('/api/idp/token', {})).status, 200);
    assert.equal(seen.at(-1).auth, `Basic ${Buffer.from(`pf-client:${SECRET}`).toString('base64')}`, 'the saved client is the one used');
    await post('/api/real/forget');
    const info = json(await get('/api/info'));
    assert.equal(info.realSource, 'env');
    assert.equal(info.real.pfHost, 'env-pf.example.com');
  });
});

test('the page learns only that a secret is saved and its last 4 characters; a blank secret keeps the saved one', async () => {
  await withApp(async ({ post, get, json, form, seen, file }) => {
    assert.deepEqual(json(await get('/api/info')).realSecret, { set: false, ends: null });
    assert.equal((await post('/api/real/connect', form())).status, 200);
    const info = await get('/api/info');
    assert.deepEqual(json(info).realSecret, { set: true, ends: '…LEAK' });
    assert.ok(!info.text.includes(SECRET), 'the secret must not appear in a response');
    // Change the client ID's neighbours without retyping the secret: the saved secret is reused and checked again
    const again = await post('/api/real/connect', form({ clientSecret: '' }));
    assert.equal(again.status, 200);
    assert.equal(seen.length, 2);
    assert.equal(seen[1].auth, seen[0].auth, 'PingFederate is called with the saved secret');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).WI_REAL_CLIENT_SECRET, SECRET);
    // A short secret shows no characters at all
    process.env.WI_REAL_CLIENT_SECRET = 'short-secret';
    Object.assign(process.env, { WI_REAL_GATEWAY_URL: 'https://gw.example.com', WI_REAL_PF_URL: 'https://pf.example.com', WI_REAL_CLIENT_ID: 'env-client' });
    forgetConnection();
    assert.deepEqual(json(await get('/api/info')).realSecret, { set: true, ends: null });
    // With only the app .env (nothing saved), a blank secret is still refused
    const blank = await post('/api/real/connect', form({ clientSecret: '' }));
    assert.equal(blank.status, 400);
    assert.match(json(blank).message, /client secret/);
  });
});

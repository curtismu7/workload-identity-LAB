import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jwks, MOCK_ISSUER, MOCK_AUDIENCE } from './keys.js';
import { mintToken, decodeUnsafe, idpMeta } from './mockIdp.js';
import { mcpCall, gatewayMeta, validateWorkloadToken } from './mockGateway.js';
import { getMode, setMode } from './mode.js';
import { realConfig, realHowTo, publicInfo, mintRealToken, holdToken, callGateway, passthroughVerdict, resolveBearer } from './realGateway.js';
import { connectionSource, formDefaults, saveConnection, forgetConnection, secretHint, savedSecret } from './realStore.js';
import { mockTrace, realTrace, realFailureTrace } from './trace.js';
import { install as installNetguard, report as netguardReport, assertMockZeroOutbound } from './netguard.js';
import { listDiagrams, getDiagram } from './diagrams.js';
import { callUpstream } from './upstream.js';
import { directCall, DIRECT_ONLY_TOOLS } from './directDoor.js';

// Rule 23: every /api route's upstream errors map to structured JSON.
const jsonError = (res, code, message, status = 502) => res.status(status).json({ error: code, message });

installNetguard();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  // Loopback host check (rulebook safety)
  const ALLOWED_HOSTS = (process.env.LAB_ALLOWED_HOSTS || 'localhost,127.0.0.1,local.ping-devops.com,workload-identity-lab,workload-identity-lab.local.ping-devops.com').split(',');
  app.use((req, res, next) => {
    const host = String(req.headers.host || '').split(':')[0];
    if (!ALLOWED_HOSTS.includes(host)) return res.status(421).json({ error: 'bad host' });
    next();
  });
  // Same-origin for writes
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET') {
      const origin = req.headers.origin;
      if (origin) {
        try {
          const originHost = new URL(origin).hostname; // strip port: the proxy rewrites Host
          const allowed = ALLOWED_HOSTS.map(h => h.split(':')[0]);
          if (!allowed.includes(originHost)) return res.status(403).json({ error: 'cross-origin write refused', detail: `origin ${originHost} not allowed` });
        } catch { return res.status(403).json({ error: 'bad origin' }); }
      }
    }
    next();
  });

  app.get('/api/diagrams', (req, res) => res.json({ diagrams: listDiagrams().map(d => ({ id: d.id, title: d.title, lede: d.lede })) }));
  app.get('/api/diagrams/:id', (req, res) => {
    const d = getDiagram(req.params.id);
    if (!d) return res.status(404).json({ error: 'not_found', message: `no diagram named ${req.params.id}` });
    res.json(d);
  });
  app.get('/api/health', (req, res) => res.json({ ok: true, contract: 'demo-health/1', app: 'workload-identity-lab' }));
  app.get('/api/info', (req, res) => {
    const cfg = realConfig();
    res.json({
      source: getMode(),
      realAvailable: cfg.ok,
      realMissing: cfg.ok ? [] : [...cfg.missing, ...cfg.invalid],
      real: cfg.ok ? publicInfo(cfg) : null, // hosts and ids only, never the secret
      realSource: connectionSource(), // 'saved' | 'memory' | 'env' | null: where the connection came from
      realForm: formDefaults(), // the three non-secret values, to prefill the Real button's form
      realSecret: secretHint(), // { set, ends: '…abcd' | null }: never the secret itself
      idp: idpMeta, gateway: gatewayMeta,
      simulated: getMode() !== 'real',
    });
  });
  app.post('/api/mode', (req, res) => {
    const next = req.body?.source;
    if (next === 'real') {
      const cfg = realConfig();
      if (!cfg.ok) return res.status(409).json({ error: 'real_not_configured', message: realHowTo(cfg) });
    }
    if (next !== 'mock' && next !== 'real') return res.status(400).json({ error: 'bad source' });
    setMode(next);
    res.json({ source: getMode() });
  });

  // The Real button's form: check the client against the real PingFederate first, save only if it accepts it.
  // The secret is read here and saved; it is never echoed back, logged, or put in any response.
  const FIELD = { WI_REAL_GATEWAY_URL: 'the gateway URL', WI_REAL_PF_URL: 'the PingFederate URL', WI_REAL_CLIENT_ID: 'the client ID', WI_REAL_CLIENT_SECRET: 'the client secret' };
  app.post('/api/real/connect', async (req, res) => {
    const b = req.body || {};
    // Trimmed first, so the value that is checked is exactly the value that gets saved (a pasted secret often has a trailing newline)
    const values = Object.fromEntries(Object.entries({ WI_REAL_GATEWAY_URL: b.gatewayUrl, WI_REAL_PF_URL: b.pfUrl, WI_REAL_CLIENT_ID: b.clientId, WI_REAL_CLIENT_SECRET: b.clientSecret })
      .map(([k, v]) => [k, typeof v === 'string' ? v.trim() : '']));
    // A blank secret keeps the one already saved (the page shows only that one is saved, never its value)
    if (!values.WI_REAL_CLIENT_SECRET) values.WI_REAL_CLIENT_SECRET = savedSecret();
    const cfg = realConfig({ ...process.env, ...values });
    if (!cfg.ok) {
      const bad = cfg.missing.length ? `Fill in ${cfg.missing.map(k => FIELD[k]).join(', ')}.` : cfg.invalid.every(k => FIELD[k]) ? `${cfg.invalid.map(k => FIELD[k]).join(' and ')} must be an https URL.` : realHowTo(cfg);
      return jsonError(res, 'bad_connection', bad, 400);
    }
    // The check is a real outbound call: run it as Real, so it never counts against Mock's zero-outbound proof.
    const before = getMode();
    setMode('real');
    try { await mintRealToken(cfg); } catch (e) {
      return jsonError(res, e.code || 'idp_error', e.message, e.code === 'idp_refused' ? 401 : 502);
    } finally { setMode(before); }
    const saved = saveConnection(values);
    res.json({ ok: true, persisted: saved.persisted, real: publicInfo(realConfig()) });
  });
  app.post('/api/real/forget', (req, res) => {
    forgetConnection();
    if (getMode() === 'real' && !realConfig().ok) setMode('mock'); // nothing left to be Real with
    res.json({ forgotten: true, source: getMode() });
  });

  // Mock IdP surface
  app.get('/api/idp/jwks', (req, res) => res.json(jwks()));
  app.get('/api/idp/meta', (req, res) => res.json(idpMeta));
  app.post('/api/idp/token', async (req, res) => {
    const { scope, resource, corrupt } = req.body || {};
    if (getMode() === 'real') {
      // Real PingFederate. The token stays on the server; the browser gets an opaque handle + decoded claims.
      const cfg = realConfig();
      if (!cfg.ok) return jsonError(res, 'real_not_configured', realHowTo(cfg), 409);
      try {
        const m = await mintRealToken(cfg, { scope, corrupt });
        // The wrong-audience case only means something if the IdP answered with another audience. Where the client's default
        // token manager IS the agent's (the cmuir-pf test client), the token is the good one: say so instead of showing a "wrong" token that is right.
        const notice = corrupt === 'wrong-audience' && [].concat(m.claims?.aud ?? []).includes(m.audience)
          ? `The wrong-audience case sent no audience, hoping ${cfg.idpName}'s default token manager would answer with another one. It issued the correct audience (this client's default token manager is the agent's), so nothing wrong was sent and the gateway will accept the token. The case shows a mix-up only where the client's default manager is a different one.`
          : undefined;
        return res.json({ token: holdToken(m.token), held: true, claims: m.claims, audience: m.audience, labelled: `real ${cfg.idpName} token (kept on the server)`, ...(notice && { notice }),
          // Demo-only, off by default: WI_SHOW_REAL_TOKEN=1 sends the minted token to the page so step 1 can show it.
          ...(process.env.WI_SHOW_REAL_TOKEN === '1' && { rawToken: m.token }) });
      } catch (e) { return jsonError(res, e.code || 'idp_error', e.message); }
    }
    if (corrupt === 'wrong-audience') {
      // Simulate the classic failure: token served by the DEFAULT token manager (aud = enduser-style)
      const t = mintToken({ scope, resource: 'https://other-system.invalid/aud' });
      return res.json({ token: t.token, claims: t.claims, labelled: 'mock — wrong audience on purpose' });
    }
    const t = mintToken({ scope, resource, corrupt });
    res.json({ token: t.token, claims: t.claims, labelled: 'mock-issued token (education: raw token shown)' });
  });
  app.post('/api/idp/decode', (req, res) => {
    const d = decodeUnsafe(req.body?.token);
    if (!d.ok) return res.status(400).json({ error: 'undecodable' });
    res.json({ payload: d.payload, note: 'decode without verification — claims are not proof' });
  });

  // Gateway door: the in-process mock, or (Real mode) the actual Privilege gateway
  app.post('/api/gateway/:app/mcp', async (req, res) => {
    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (getMode() === 'real') {
      const cfg = realConfig();
      if (!cfg.ok) return jsonError(res, 'real_not_configured', realHowTo(cfg), 409);
      const appName = { 'federated-agent': cfg.agentApp, 'federated-rs': cfg.rsApp }[req.params.app];
      if (!appName) return jsonError(res, 'unknown_app', `no gateway app mapped for ${req.params.app}`, 404);
      try {
        const out = await callGateway(cfg, appName, token, req.body);
        const _meta = { source: 'real', log: out.log, stage: out.stage, detail: out.detail, gatewayUrl: out.url, requestId: out.requestId, at: out.at };
        if (req.params.app === 'federated-rs' && out.status === 200) _meta.unchanged = passthroughVerdict(token, out.body);
        _meta.trace = realTrace({ url: out.url, bearer: token, resolve: resolveBearer, rpc: req.body, out, unchanged: _meta.unchanged });
        return res.status(out.status).json({ ...out.body, _meta });
      } catch (e) {
        // Rule 23: a named failure, with the same _meta shape the page already reads
        const trace = realFailureTrace({ url: `${cfg.gateway}/${appName}/mcp`, bearer: token, resolve: resolveBearer, rpc: req.body, error: e.message });
        return res.status(502).json({ error: e.code || 'upstream_error', message: e.message, _meta: { source: 'real', stage: e.code || 'upstream_error', detail: e.message, log: e.message, trace } });
      }
    }
    const out = mcpCall(token, req.body);
    res.status(out.http).json({ ...out.body, _meta: { lane: 'gateway', log: out.log, stage: out.stage, detail: out.detail, claims: out.claims, trace: mockTrace({ app: req.params.app, token, rpc: req.body, out }) } });
  });

  // The DIRECT door: the same token, straight to the MCP backend, no gateway in between.
  // The backend verifies only the JWT signature and lifetime — no audience binding, no
  // required-claims pinning, no grant/tool filtering, no Pass Agent Token distinction.
  app.post('/api/direct/:app/mcp', (req, res) => {
    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (getMode() === 'real') return jsonError(res, 'real_not_configured', 'The direct door is a mock-only comparison path; switch to Mock mode.', 409);
    const out = directCall(token, req.body);
    res.status(out.http).json({ ...out.body, _meta: { lane: 'direct', log: out.log, stage: out.stage, claims: out.claims, directOnlyTools: DIRECT_ONLY_TOOLS } });
  });

  // Validate-only (what the gateway checks, step by step)
  app.post('/api/validate', (req, res) => {
    const out = validateWorkloadToken(req.body?.token || '');
    res.json({ accepted: out.ok, stage: out.stage, detail: out.detail, log: out.log, claims: out.claims });
  });

  // Run log (in-memory, Reset clears)
  const runs = [];
  app.post('/api/runs', (req, res) => {
    const r = { at: new Date().toISOString(), ...req.body };
    runs.unshift(r); if (runs.length > 100) runs.pop();
    res.json({ ok: true });
  });
  app.get('/api/runs', (req, res) => res.json({ runs }));

  // Reset (API + script)
  app.post('/api/reset', (req, res) => { runs.length = 0; res.json({ ok: true, reset: true }); });

  // Netguard evidence (mock mode must show zero outbound)
  app.get('/api/netguard', (req, res) => res.json({ ...assertMockZeroOutbound(), log: netguardReport() }));

  // Serve the built SPA
  const dist = path.join(__dirname, '../../web/dist');
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));

  return app;
}

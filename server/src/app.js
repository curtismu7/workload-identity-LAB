import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jwks, MOCK_ISSUER, MOCK_AUDIENCE } from './keys.js';
import { mintToken, decodeUnsafe, idpMeta } from './mockIdp.js';
import { mcpCall, gatewayMeta, validateWorkloadToken } from './mockGateway.js';
import { getMode, setMode, realAvailable } from './mode.js';
import { install as installNetguard, report as netguardReport, assertMockZeroOutbound } from './netguard.js';
import { listDiagrams, getDiagram } from './diagrams.js';
import { callUpstream } from './upstream.js';

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
        try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'cross-origin write refused' }); }
        catch { return res.status(403).json({ error: 'bad origin' }); }
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
  app.get('/api/info', (req, res) => res.json({ source: getMode(), realAvailable: realAvailable(), idp: idpMeta, gateway: gatewayMeta, simulated: true }));
  app.post('/api/mode', (req, res) => {
    const next = req.body?.source;
    if (next === 'real' && !realAvailable()) return res.status(409).json({ error: 'real_not_configured', message: 'Real mode needs WI_REAL_GATEWAY_URL and WI_REAL_CLIENT_SECRET in the app .env' });
    if (next !== 'mock' && next !== 'real') return res.status(400).json({ error: 'bad source' });
    setMode(next);
    res.json({ source: getMode() });
  });

  // Mock IdP surface
  app.get('/api/idp/jwks', (req, res) => res.json(jwks()));
  app.get('/api/idp/meta', (req, res) => res.json(idpMeta));
  app.post('/api/idp/token', (req, res) => {
    const { scope, resource, corrupt } = req.body || {};
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

  // Mock gateway door
  app.post('/api/gateway/:app/mcp', (req, res) => {
    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (getMode() !== 'mock') return res.status(409).json({ error: 'real_mode_active', message: 'Switch to Mock for the in-process gateway' });
    const out = mcpCall(token, req.body);
    res.status(out.http).json({ ...out.body, _meta: { log: out.log, stage: out.stage, detail: out.detail, claims: out.claims } });
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

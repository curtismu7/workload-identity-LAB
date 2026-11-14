import React, { useEffect, useState, useCallback } from 'react';
import TopMenu, { applyFontSize } from './top-menu/TopMenu.jsx';
import Diagram from './components/Diagram.jsx';
import JsonView from './components/JsonView.jsx';

const api = async (path, body, extraHeaders = {}) => {
  const res = await fetch(path, body === undefined
    ? { headers: extraHeaders }
    : { method: 'POST', headers: { 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};

const Chip = ({ ok, children }) => (
  <span className={`status-chip ${ok ? 'wi-chip-ok' : 'wi-chip-deny'}`} data-testid={ok ? 'chip-ok' : 'chip-deny'}>{children}</span>
);

export default function App() {
  const [info, setInfo] = useState(null);
  const [theme, setTheme] = useState('auto');
  const [fontSize, setFontSize] = useState('M');
  const [mode, setModeState] = useState('mock');
  const [scope, setScope] = useState('openid federated:read whoami:read');
  const [corrupt, setCorrupt] = useState('');
  const [claims, setClaims] = useState(null);
  const [token, setToken] = useState(null);
  const [gatewayResult, setGatewayResult] = useState(null);
  const [whoami, setWhoami] = useState(null);
  const [control, setControl] = useState(null);
  const [runs, setRuns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadRuns = useCallback(async () => {
    const { json } = await api('/api/runs');
    setRuns(json.runs || []);
  }, []);

  useEffect(() => {
    api('/api/info').then(({ json }) => { setInfo(json); setModeState(json.source); });
    loadRuns();
  }, [loadRuns]);

  // Apply the theme choice (TopMenu is controlled; the app owns the attribute)
  useEffect(() => {
    if (theme === 'auto') {
      document.documentElement.removeAttribute('data-theme');
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => { document.documentElement.removeAttribute('data-theme'); };
      mq.addEventListener?.('change', onChange);
      return () => mq.removeEventListener?.('change', onChange);
    }
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Text size: the TopMenu control sets --fs, app.css maps it onto the root font size
  useEffect(() => { applyFontSize(fontSize); }, [fontSize]);

  const logRun = async (step, ok, detail) => {
    await api('/api/runs', { step, ok, detail });
    loadRuns();
  };

  const switchMode = async (next) => {
    setError('');
    const { status, json } = await api('/api/mode', { source: next });
    if (status === 409) { setError(json.message || 'Real mode is not configured'); return; }
    setModeState(next);
    const { json: info2 } = await api('/api/info');
    setInfo(info2);
  };

  const runDemo = async () => {
    setBusy(true); setError('');
    setClaims(null); setToken(null); setGatewayResult(null); setWhoami(null); setControl(null);
    try {
      // Step 1: mint
      const mint = await api('/api/idp/token', { scope, corrupt: corrupt || undefined });
      setToken(mint.json.token);
      setClaims(mint.json.claims);
      await logRun('1 mint', true, `IdP issued a token (aud=${mint.json.claims?.aud})`);
      // Step 2: gateway tools/list
      const gw = await api('/api/gateway/federated-agent/mcp',
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        { authorization: `Bearer ${mint.json.token}` });
      setGatewayResult({ status: gw.status, json: gw.json });
      await logRun('2 tools/list', gw.status === 200, gw.status === 200
        ? `accepted: ${gw.json._meta?.log}`
        : `refused (${gw.json._meta?.stage}): ${gw.json._meta?.detail}`);
      // Step 3: whoami passthrough
      const w = await api('/api/gateway/federated-rs/mcp',
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'whoami', arguments: {} } },
        { authorization: `Bearer ${mint.json.token}` });
      setWhoami({ status: w.status, json: w.json });
      await logRun('3 whoami', w.status === 200, w.status === 200 ? 'backend received the token unchanged' : 'refused');
      // Step 4: control
      const c = await api('/api/gateway/federated-agent/mcp',
        { jsonrpc: '2.0', id: 3, method: 'tools/list' },
        { authorization: 'Bearer garbage-token-not-real' });
      setControl(c.status);
      await logRun('4 control', c.status === 401, `garbage bearer -> ${c.status}`);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    await api('/api/reset', {});
    setClaims(null); setToken(null); setGatewayResult(null); setWhoami(null); setControl(null); setRuns([]);
  };

  const gwOk = gatewayResult?.status === 200;
  const whoOk = whoami?.status === 200;
  const backendClaims = (() => {
    try {
      const text = whoami?.json?.result?.content?.[0]?.text;
      return text ? JSON.parse(text) : null;
    } catch { return null; }
  })();

  return (
    <div className="lab-root">
      <div className="lab-bar">
        <TopMenu
          mode={{ value: mode, onChange: switchMode, realAvailable: info?.realAvailable, realHint: 'Set WI_REAL_GATEWAY_URL and WI_REAL_CLIENT_SECRET in the app .env' }}
          theme={{ value: theme, onChange: setTheme }}
          fontSize={{ value: fontSize, onChange: setFontSize }}
          help={{ href: 'https://github.com/curtismu7/workload-identity-LAB#readme' }}
          version="v0.1.0"
          onReset={reset}
        />
      </div>
      <div className="sim-banner" data-testid="sim-banner">
        {mode === 'mock'
          ? 'SIMULATED — the IdP, gateway and MCP backend on this page are in-process mocks; no real system is called. Mock-issued tokens are labelled.'
          : 'REAL — calls go to the configured PingFederate and Privilege gateway. Credentials come from the app .env (owner-run).'}
      </div>
      <main className="lab-main">
        <h1>Federated agents: workload identity through the gateway</h1>
        <p className="lab-lead">
          The agent holds <strong>no gateway secret</strong>. Its own identity platform vouches for it
          with a signed JWT; the gateway verifies that vouching (issuer JWKS, audience, required claims)
          and forwards the identity to the backend. Same grant/policy machinery as Agent Registry keys —
          but the credential comes from outside.
        </p>
        {error && <div className="lab-error" role="alert" data-testid="mode-error">{error}</div>}

        <section className="wi-grid">
          <div className="wi-card">
            <h2>Run the flow</h2>
            <div className="field-row">
              <label htmlFor="scope">Token scope</label>
              <input id="scope" data-testid="scope-input" value={scope} onChange={e => setScope(e.target.value)} />
            </div>
            <div className="field-row">
              <label htmlFor="corrupt">Negative case</label>
              <select id="corrupt" data-testid="corrupt-select" value={corrupt} onChange={e => setCorrupt(e.target.value)}>
                <option value="">— none (happy path) —</option>
                <option value="signature">flip a signature char</option>
                <option value="wrong-audience">wrong audience (token manager mix-up)</option>
              </select>
            </div>
            <button className="primary" data-testid="run-btn" onClick={runDemo} disabled={busy}>
              {busy ? 'Running…' : 'Run'}
            </button>
            <div className="wi-steps">
              <div className="wi-step"><span className="wi-step-num">1</span>
                <div><strong>Mint</strong> — the IdP issues a JWT for the agent.
                  {claims && <Chip ok>{claims.iss}</Chip>}</div></div>
              <div className="wi-step"><span className="wi-step-num">2</span>
                <div><strong>Gateway check</strong> — <code>tools/list</code> with the JWT.
                  {gatewayResult && (gwOk ? <Chip ok>200 accepted</Chip> : <Chip ok={false}>{gatewayResult.status} {gatewayResult.json?._meta?.stage}</Chip>)}
                  {gatewayResult && <div className="wi-claims" data-testid="gateway-log">{gatewayResult.json?._meta?.log}</div>}
                  {gwOk && <div data-testid="tool-list">{(gatewayResult.json?.result?.tools || []).map(t => t.name).join(', ')}</div>}
                </div></div>
              <div className="wi-step"><span className="wi-step-num">3</span>
                <div><strong>Pass Agent Token</strong> — the backend reports what it received.
                  {whoami && (whoOk ? <Chip ok>token unchanged</Chip> : <Chip ok={false}>{whoami.status}</Chip>)}
                  {backendClaims && <JsonView data={backendClaims.receivedClaims || backendClaims} testid="whoami-claims" label="what the backend received" />}
                </div></div>
              <div className="wi-step"><span className="wi-step-num">4</span>
                <div><strong>Control</strong> — garbage bearer.
                  {control && (control === 401 ? <Chip ok>401 refused</Chip> : <Chip ok={false}>{control}</Chip>)}</div></div>
            </div>
          </div>

          <div className="wi-card">
            <h2>The token (raw, education)</h2>
            {token
              ? <div className="wi-claims" data-testid="raw-token">{token}</div>
              : <p className="muted">Press Run to mint one.</p>}
            {claims && (
              <>
                <h3>Decoded claims</h3>
                <JsonView data={claims} testid="claims-view" label="IdP token claims" />
              </>
            )}
          </div>

          <div className="wi-card">
            <h2>Run log</h2>
            <div className="wi-runlog" data-testid="run-log">
              {runs.length === 0 && <p className="muted">No runs yet.</p>}
              {runs.map((r, i) => (
                <div key={i} className="wi-step">
                  <Chip ok={r.ok}>{r.step}</Chip>
                  <span>{r.detail}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="wi-card">
            <h2>Two ways an agent identifies</h2>
            <table className="lab-table" data-testid="kinds-table">
              <thead><tr><th>Kind</th><th>Credential</th><th>Gateway check</th></tr></thead>
              <tbody>
                <tr><td>Virtual key (Agent Registry)</td><td>secret string</td><td>lookup + scope + owner</td></tr>
                <tr><td>Workload identity</td><td>JWT from the caller's own platform</td><td>signature vs registered JWKS, iss/aud/claims</td></tr>
              </tbody>
            </table>
            <p className="muted">
              Mock mode exercises the identical check order in-process: signature → issuer → audience →
              required claims → lifetime → grant.
            </p>
          </div>

          <div className="wi-card" style={{ gridColumn: '1 / -1' }}>
            <h2>The hop chain</h2>
            <Diagram diagramId="workload-identity-flow" theme={theme === 'auto' ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme} />
          </div>
        </section>
      </main>
    </div>
  );
}

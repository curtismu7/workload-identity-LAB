import React, { useEffect, useState, useCallback } from 'react';
import TopMenu, { applyFontSize } from './top-menu/TopMenu.jsx';
import Diagram from './components/Diagram.jsx';
import JsonPane from './components/JsonPane.jsx';
import GatewayTrace from './components/GatewayTrace.jsx';

const api = async (path, body, extraHeaders = {}) => {
  const res = await fetch(path, body === undefined
    ? { headers: extraHeaders }
    : { method: 'POST', headers: { 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};

// The gateway's lifetime check reads `exp`; iss, aud, sub, act, client_id and scope (its other checks) are hot by default.
const CLAIMS_HOT = ['exp'];

const MOCK_SCOPE = 'openid federated:read whoami:read';

const Chip = ({ ok, children }) => (
  <span className={`status-chip ${ok ? 'wi-chip-ok' : 'wi-chip-deny'}`} data-testid={ok ? 'chip-ok' : 'chip-deny'}>{children}</span>
);

export default function App() {
  const [info, setInfo] = useState(null);
  const [theme, setTheme] = useState('auto');
  const [fontSize, setFontSize] = useState('M');
  const [mode, setModeState] = useState('mock');
  const [scope, setScope] = useState(MOCK_SCOPE);
  const [corrupt, setCorrupt] = useState('');
  const [claims, setClaims] = useState(null);
  const [token, setToken] = useState(null);
  const [tokenHeld, setTokenHeld] = useState(false); // Real mode: the token stays on the server
  const [gatewayResult, setGatewayResult] = useState(null);
  const [whoami, setWhoami] = useState(null);
  const [control, setControl] = useState(null);
  const [traces, setTraces] = useState([]); // what the gateway did, one entry per gateway call
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
    // The two modes use different scope names: swap the default, never a value the user typed
    const realScopes = info2.real?.scopes;
    setScope(prev => (next === 'real' ? (prev === MOCK_SCOPE && realScopes ? realScopes : prev) : (prev === realScopes ? MOCK_SCOPE : prev)));
  };

  const runDemo = async () => {
    setBusy(true); setError('');
    setClaims(null); setToken(null); setTokenHeld(false); setGatewayResult(null); setWhoami(null); setControl(null); setTraces([]);
    const addTrace = (step, title, r) => {
      if (r.json?._meta?.trace) setTraces(prev => [...prev, { step, title, status: r.status, trace: r.json._meta.trace }]);
    };
    try {
      // Step 1: mint
      const mint = await api('/api/idp/token', { scope, corrupt: corrupt || undefined });
      if (mint.status !== 200) {
        // Real mode: PingFederate (or the config) said no. Name it and stop; there is no token to send.
        const why = mint.json.message || `The token request failed (HTTP ${mint.status})`;
        setError(why);
        await logRun('1 mint', false, why);
        return;
      }
      setToken(mint.json.token);
      setTokenHeld(Boolean(mint.json.held));
      setClaims(mint.json.claims);
      await logRun('1 mint', true, `IdP issued a token (aud=${mint.json.claims?.aud})`);
      // Step 2: gateway tools/list
      const gw = await api('/api/gateway/federated-agent/mcp',
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        { authorization: `Bearer ${mint.json.token}` });
      setGatewayResult({ status: gw.status, json: gw.json });
      addTrace(2, 'Gateway check: tools/list', gw);
      await logRun('2 tools/list', gw.status === 200, gw.status === 200
        ? `accepted: ${gw.json._meta?.log}`
        : `refused (${gw.json._meta?.stage}): ${gw.json._meta?.detail}`);
      // Step 3: whoami passthrough
      const w = await api('/api/gateway/federated-rs/mcp',
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'whoami', arguments: {} } },
        { authorization: `Bearer ${mint.json.token}` });
      setWhoami({ status: w.status, json: w.json });
      addTrace(3, 'Pass Agent Token: whoami', w);
      const verdict = w.json?._meta?.unchanged; // Real mode: true/false/null, from comparing the claims
      const realRun = w.json?._meta?.source === 'real';
      await logRun('3 whoami', w.status === 200 && verdict !== false,
        w.status !== 200 ? 'refused'
          : verdict === false ? 'the backend reported DIFFERENT claims than the ones minted'
            : realRun && verdict !== true ? 'backend answered 200 (its reply had no claims to compare)'
              : 'backend received the token unchanged');
      // Step 4: control
      const c = await api('/api/gateway/federated-agent/mcp',
        { jsonrpc: '2.0', id: 3, method: 'tools/list' },
        { authorization: 'Bearer garbage-token-not-real' });
      setControl(c.status);
      addTrace(4, 'Control: garbage bearer', c);
      await logRun('4 control', c.status === 401, `garbage bearer -> ${c.status}`);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    await api('/api/reset', {});
    setClaims(null); setToken(null); setTokenHeld(false); setGatewayResult(null); setWhoami(null); setControl(null); setTraces([]); setRuns([]);
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
          mode={{ value: mode, onChange: switchMode, realAvailable: info?.realAvailable, realHint: 'Set WI_REAL_GATEWAY_URL, WI_REAL_PF_URL, WI_REAL_CLIENT_ID and WI_REAL_CLIENT_SECRET in the app .env' }}
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
          : `REAL — the token is minted by ${info?.real?.pfHost || 'PingFederate'} and every call goes to the Privilege gateway at ${info?.real?.gatewayHost || 'the configured host'}. Credentials stay on the server (app .env, owner-run).`}
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
                <option value="">None</option>
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
                  {claims && <Chip ok>{claims.iss || claims.note}</Chip>}</div></div>
              <div className="wi-step"><span className="wi-step-num">2</span>
                <div><strong>Gateway check</strong> — <code>tools/list</code> with the JWT.
                  {gatewayResult && (gwOk ? <Chip ok>200 accepted</Chip> : <Chip ok={false}>{gatewayResult.status} {gatewayResult.json?._meta?.stage}</Chip>)}
                  {gatewayResult && <div className="wi-claims" data-testid="gateway-log">{gatewayResult.json?._meta?.log}</div>}
                  {gwOk && <div data-testid="tool-list">{(gatewayResult.json?.result?.tools || []).map(t => t.name).join(', ')}</div>}
                </div></div>
              <div className="wi-step"><span className="wi-step-num">3</span>
                <div><strong>Pass Agent Token</strong> — the backend reports what it received.
                  {whoami && (!whoOk ? <Chip ok={false}>{whoami.status}</Chip>
                    : whoami.json?._meta?.unchanged === false ? <Chip ok={false}>token changed</Chip>
                      : <Chip ok>{whoami.json?._meta?.source === 'real' && whoami.json._meta.unchanged !== true ? '200 received' : 'token unchanged'}</Chip>)}
                  {backendClaims && <JsonPane value={backendClaims.receivedClaims || backendClaims} testId="whoami-claims" label="what the backend received" hot={CLAIMS_HOT} />}
                </div></div>
              <div className="wi-step"><span className="wi-step-num">4</span>
                <div><strong>Control</strong> — garbage bearer.
                  {control && (control === 401 ? <Chip ok>401 refused</Chip> : <Chip ok={false}>{control}</Chip>)}</div></div>
            </div>
          </div>

          <div className="wi-card">
            <h2>The token (raw, education)</h2>
            {token
              ? (tokenHeld
                ? <p className="muted" data-testid="token-held">The real token stays on the server and is never shown here. The decoded claims below are what the gateway checks.</p>
                : <JsonPane value={token} testId="raw-token" label="Raw token (mock-issued)" />)
              : <p className="muted">Press Run to mint one.</p>}
            {claims && (
              <>
                <h3>Decoded claims</h3>
                <JsonPane value={claims} testId="claims-view" label="IdP token claims" hot={CLAIMS_HOT} />
              </>
            )}
          </div>

          <div className="wi-card wi-card-wide">
            <GatewayTrace exchanges={traces} source={mode} />
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

          <div className="wi-card wi-card-wide" data-testid="privilege-proof">
            <h2>Show it in Privilege</h2>
            <p className="wi-prose">
              {mode === 'real'
                ? 'Every Run on this page sent real requests to the Privilege gateway. The console shows how it is set up, and the gateway log shows it accepting the call.'
                : 'This page simulates the gateway. What proves a real Privilege gateway does the same thing is in the Privilege console and the gateway log.'}
            </p>

            <h3>Same fields, two places</h3>
            <table className="lab-table" data-testid="console-map">
              <thead><tr><th>On this page</th><th>In the Privilege console</th></tr></thead>
              <tbody>
                <tr><td>Token issuer (<code>iss</code>)</td><td>Non-Human Identity: <strong>Issuer</strong></td></tr>
                <tr><td>The keys the signature is checked against</td><td>Key source: fetch from the IdP's <strong>JWKS URL</strong></td></tr>
                <tr><td>Audience (<code>aud</code>)</td><td><strong>Audience</strong>, which must match the token exactly</td></tr>
                <tr><td><code>act.sub</code> and <code>client_id</code></td><td><strong>Required claims</strong></td></tr>
                <tr><td><code>scope</code></td><td><strong>Permissions</strong> (<code>mcp</code>)</td></tr>
                <tr><td>The tool list in step 2</td><td>Agent Registry: the agent's <strong>Tool Access</strong></td></tr>
                <tr><td>Step 3, the backend sees the token unchanged</td><td>The MCP server app: <strong>Auth Mode: Pass Agent Token</strong></td></tr>
              </tbody>
            </table>
            <p className="muted">
              Newer Privilege releases call a Non-Human Identity a Federated Identity. Same object.
            </p>

            <h3>Walk the console in this order</h3>
            <ol className="wi-prove">
              <li><strong>Non-Human Identities</strong>: open the agent's identity. Issuer, JWKS URL, audience, required
                claims and scope <code>mcp</code> are all there, and no secret is stored for the agent.</li>
              <li><strong>Agent Registry</strong>: open the agent. Its custodian is that identity, with no key value to
                copy. Gateway &amp; Apps names the agent app, and Tool Access lists the tools from step 2.</li>
              <li><strong>Agentic Apps</strong>: open the MCP server. Auth Mode is Pass Agent Token. Before the first
                call its Overview reads "Awaiting first agent call"; after it, the tools are discovered from the
                forwarded token.</li>
              <li><strong>Gateway log</strong>: this is the proof a call went through. An accepted call logs{' '}
                <code data-testid="proof-log-line">{'workload token accepted for key <key> issuer=<iss> subject=<sub>'}</code>{' '}
                with no <code>policy denied</code> beside it. A garbage bearer is a 401, and a bad token logs{' '}
                <code>workload token rejected</code> with the reason. The log is in the gateway pod at{' '}
                <code>/var/log/procyon/cyonproxy.log</code> (check the newest rotated file too).</li>
            </ol>

            {mode === 'real'
              ? (
                <p className="muted" data-testid="proof-real-note">
                  Steps 2 and 3 above are real requests to <code>{info?.real?.gatewayHost}</code>, authorised only by the
                  PingFederate token from step 1. Find them in the gateway log at the time of the Run (step 2 shows the
                  gateway's request id when it returns one). The console objects above are the configuration that accepted them.
                </p>
              ) : (
                <p className="muted" data-testid="proof-mock-note">
                  In Mock mode nothing leaves this page, so these runs leave nothing in Privilege. Switch the Mode menu to
                  Real to send the same four steps to the real gateway (it needs the Real settings in the app <code>.env</code>;
                  see the README). The setup guide is <code>privilege/GATEWAY-WORKLOAD-IDENTITY-SETUP.md</code> in AI-DEMO2.
                </p>
              )}
          </div>
        </section>
      </main>
    </div>
  );
}

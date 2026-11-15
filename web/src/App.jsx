import React, { useEffect, useState, useCallback } from 'react';
import TopMenu, { applyFontSize } from './top-menu/TopMenu.jsx';
import Diagram from './components/Diagram.jsx';
import JsonPane from './components/JsonPane.jsx';
import JwtBox from './components/JwtBox.jsx';
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
const DIRECT_ONLY_TOOLS = ['GrantAdminTool', 'DeleteAllTool'];

const CONNECTION_NOTE = {
  saved: "The secret is saved on this lab's Docker volume and is never sent to the browser.",
  memory: "The volume cannot be written, so the secret is kept in memory for this run only.",
  env: 'Set in the app .env.',
};

const Chip = ({ ok, children }) => (
  <span className={`status-chip ${ok ? 'wi-chip-ok' : 'wi-chip-deny'}`} data-testid={ok ? 'chip-ok' : 'chip-deny'}>{children}</span>
);

// The direct whoami shows raw token claims (rule 4: tokens shown raw, education) — through
// JsonPane, which renders everything as inert text and passes visible() over every value.
const DirectWhoamiPane = ({ response }) => {
  const backendClaims = (() => {
    try { return JSON.parse(response?.result?.content?.[0]?.text); } catch { return null; }
  })();
  if (!backendClaims) return null;
  return <JsonPane value={backendClaims.receivedClaims || backendClaims} testId="direct-whoami-claims" label="what the direct backend received" hot={CLAIMS_HOT} />;
};

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
  const [path, setPath] = useState('gateway'); // which door the Run flow walks: 'gateway' | 'direct'
  const [directResult, setDirectResult] = useState(null); // direct-door tools/list result
  const [directWhoami, setDirectWhoami] = useState(null);
  const [breakResult, setBreakResult] = useState(null); // Break-it outcomes: {tampered, escalated}
  const [error, setError] = useState('');
  const [showConnect, setShowConnect] = useState(false); // the Real button's form
  const [form, setForm] = useState({ gatewayUrl: '', pfUrl: '', clientId: '', clientSecret: '' });
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');

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

  // Results belong to the mode that produced them: a Real run must never be shown under the Simulated caption
  const clearResults = () => { setClaims(null); setToken(null); setTokenHeld(false); setGatewayResult(null); setWhoami(null); setControl(null); setTraces([]); setDirectResult(null); setDirectWhoami(null); setBreakResult(null); };

  const switchMode = async (next) => {
    setError('');
    const { status, json } = await api('/api/mode', { source: next });
    if (status === 409) { setError(json.message || 'Real mode is not configured'); return null; }
    setModeState(next);
    clearResults();
    const { json: info2 } = await api('/api/info');
    setInfo(info2);
    // The two modes use different scope names: swap the default, never a value the user typed
    const realScopes = info2.real?.scopes;
    const nextScope = next === 'real' ? (scope === MOCK_SCOPE && realScopes ? realScopes : scope) : (scope === realScopes ? MOCK_SCOPE : scope);
    setScope(nextScope);
    return nextScope; // so a run that follows right away uses it (state would still hold the old scope)
  };

  // The Real button: already connected -> switch to Real and run; otherwise ask for the connection first.
  const runReal = async () => {
    setError('');
    // Ask the server now: the page's copy of the info may not have loaded yet, or may be stale
    const { json: cur } = await api('/api/info');
    setInfo(cur);
    if (!cur.realAvailable) {
      setForm({ ...cur.realForm, clientSecret: '' });
      setConnectError('');
      setShowConnect(true);
      return;
    }
    const s = await switchMode('real');
    if (s !== null) runDemo(s);
  };
  const cancelConnect = () => { setForm(f => ({ ...f, clientSecret: '' })); setConnectError(''); setShowConnect(false); };
  const connect = async (e) => {
    e.preventDefault();
    setConnecting(true); setConnectError('');
    const { status, json } = await api('/api/real/connect', form);
    setConnecting(false);
    if (status !== 200) { setConnectError(json.message || `Could not connect (HTTP ${status})`); return; }
    cancelConnect(); // the secret is saved on the server now: drop it from the page
    const s = await switchMode('real');
    if (s !== null) runDemo(s);
  };
  const forget = async () => {
    await api('/api/real/forget', {});
    const { json: info2 } = await api('/api/info');
    if (info2.source === 'mock' && scope === info?.real?.scopes) setScope(MOCK_SCOPE);
    setInfo(info2); setModeState(info2.source);
    clearResults();
  };

  const runDemo = async (scopeToUse = scope, pathToUse = path) => {
    setBusy(true); setError('');
    setClaims(null); setToken(null); setTokenHeld(false); setGatewayResult(null); setWhoami(null); setControl(null); setTraces([]); setDirectResult(null); setDirectWhoami(null); setBreakResult(null);
    const addTrace = (step, title, r) => {
      if (r.json?._meta?.trace) setTraces(prev => [...prev, { step, title, status: r.status, trace: r.json._meta.trace }]);
    };
    try {
      // Step 1: mint
      const mint = await api('/api/idp/token', { scope: scopeToUse, corrupt: corrupt || undefined });
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
      if (pathToUse === 'direct') {
        // The ungoverned lane: the same token, straight to the backend.
        const d = await api('/api/direct/backend/mcp',
          { jsonrpc: '2.0', id: 1, method: 'tools/list' },
          { authorization: `Bearer ${mint.json.token}` });
        setDirectResult({ status: d.status, json: d.json });
        await logRun('2 direct tools/list', d.status === 200,
          d.status === 200 ? `direct backend accepted: ${d.json._meta?.log}` : `refused (${d.json._meta?.stage}): ${d.json._meta?.detail}`);
        const dw = await api('/api/direct/backend/mcp',
          { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'whoami', arguments: {} } },
          { authorization: `Bearer ${mint.json.token}` });
        setDirectWhoami({ status: dw.status, json: dw.json });
        await logRun('3 direct whoami', dw.status === 200, dw.status === 200 ? 'direct backend answered with the token claims as presented' : 'refused');
        return;
      }
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

  // Break it (direct path): tampered signature -> refused only at signature level;
  // scope escalation -> the direct backend lets a token minted with federated:admin straight through.
  const breakIt = async (kind) => {
    setBusy(true); setError('');
    try {
      if (kind === 'tampered') {
        const mint = await api('/api/idp/token', { scope, corrupt: 'signature' });
        if (mint.status !== 200) { setError('Could not mint the tampered token'); return; }
        const r = await api('/api/direct/backend/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: `Bearer ${mint.json.token}` });
        setBreakResult(prev => ({ ...prev, tampered: { status: r.status, json: r.json } }));
        await logRun('break: tampered token', r.status === 401, r.status === 401
          ? `direct backend refused it at ${r.json._meta?.stage}: ${r.json._meta?.detail}`
          : `unexpected ${r.status}`);
      } else {
        const mint = await api('/api/idp/token', { scope: 'federated:admin' });
        if (mint.status !== 200) { setError('Could not mint the escalated token'); return; }
        const r = await api('/api/direct/backend/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'GrantAdminTool', arguments: {} } }, { authorization: `Bearer ${mint.json.token}` });
        setBreakResult(prev => ({ ...prev, escalated: { status: r.status, json: r.json } }));
        await logRun('break: scope escalation', true, r.status === 200
          ? 'the direct backend EXECUTED GrantAdminTool — no grant to check it against (the gateway path refuses this)'
          : `unexpected ${r.status}`);
      }
    } finally { setBusy(false); }
  };

  const reset = async () => {
    await api('/api/reset', {});
    clearResults(); setRuns([]);
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
          mode={{ value: mode, onChange: switchMode, realAvailable: info?.realAvailable, realHint: 'Click “Run through Privilege (Real)” on the page to connect first' }}
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
          : `REAL — the token is minted by ${info?.real?.pfHost || 'PingFederate'} and every call goes to the Privilege gateway at ${info?.real?.gatewayHost || 'the configured host'}. The client secret stays on the server and is never sent to the browser.`}
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
            <div className="field-row">
              <label id="path-label">Path</label>
              <div className="wi-seg" role="radiogroup" aria-labelledby="path-label">
                <button type="button" role="radio" aria-checked={path === 'gateway'} data-testid="path-privilege"
                  className={path === 'gateway' ? 'wi-seg-on' : ''} onClick={() => setPath('gateway')}>Privilege gateway</button>
                <button type="button" role="radio" aria-checked={path === 'direct'} data-testid="path-direct"
                  className={path === 'direct' ? 'wi-seg-on' : ''} onClick={() => setPath('direct')}>Direct (no gateway)</button>
              </div>
            </div>
            <div className="wi-actions">
              <button className="primary" data-testid="run-btn" onClick={() => runDemo()} disabled={busy}>
                {busy ? 'Running…' : 'Run'}
              </button>
              <button className="primary" data-testid="real-btn" onClick={runReal} disabled={busy || connecting}>
                Run through Privilege (Real)
              </button>
            </div>
            {info?.realAvailable && info.real && (
              <p className="muted wi-real-status" data-testid="real-status">
                Connected: {info.real.pfHost} → {info.real.gatewayHost}, client {info.real.clientId}.{' '}
                {CONNECTION_NOTE[info.realSource]}
                {(info.realSource === 'saved' || info.realSource === 'memory') && (
                  <> <button type="button" className="wi-forget" data-testid="real-forget" onClick={forget}>Forget the saved connection</button></>
                )}
              </p>
            )}
            {showConnect && (
              <form className="wi-connect" data-testid="connect-form" onSubmit={connect} autoComplete="off">
                <h3>Connect to PingFederate and the Privilege gateway</h3>
                <p className="muted">
                  Paste the client secret once. The server checks it against PingFederate, then saves it on this lab's
                  Docker volume. It is never sent back to this page.
                </p>
                <div className="field-row">
                  <label htmlFor="cx-gateway">Privilege gateway URL</label>
                  <input id="cx-gateway" data-testid="connect-gateway" inputMode="url" placeholder="https://<gateway-host>" value={form.gatewayUrl || ''} onChange={e => setForm(f => ({ ...f, gatewayUrl: e.target.value }))} />
                </div>
                <div className="field-row">
                  <label htmlFor="cx-pf">PingFederate URL</label>
                  <input id="cx-pf" data-testid="connect-pf" inputMode="url" placeholder="https://<pingfederate-host>" value={form.pfUrl || ''} onChange={e => setForm(f => ({ ...f, pfUrl: e.target.value }))} />
                </div>
                <div className="field-row">
                  <label htmlFor="cx-client">Client ID</label>
                  <input id="cx-client" data-testid="connect-client" value={form.clientId || ''} onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))} />
                </div>
                <div className="field-row">
                  <label htmlFor="cx-secret">Client secret</label>
                  <input id="cx-secret" data-testid="connect-secret" type="password" autoComplete="new-password" spellCheck={false}
                    autoFocus={Boolean(form.gatewayUrl && form.pfUrl && form.clientId)}
                    value={form.clientSecret || ''} onChange={e => setForm(f => ({ ...f, clientSecret: e.target.value }))} />
                </div>
                {connectError && <div className="lab-error" role="alert" data-testid="connect-error">{connectError}</div>}
                <div className="wi-actions">
                  <button className="primary" type="submit" data-testid="connect-btn" disabled={connecting}>
                    {connecting ? 'Checking with PingFederate…' : 'Connect and run'}
                  </button>
                  <button type="button" data-testid="connect-cancel" onClick={cancelConnect} disabled={connecting}>Cancel</button>
                </div>
              </form>
            )}
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
              {path === 'direct' && (
                <>
                  <div className="wi-step"><span className="wi-step-num">2</span>
                    <div><strong>Direct tools/list</strong> — the same token, straight to the backend.
                      {directResult && (directResult.status === 200 ? <Chip ok>200 accepted</Chip> : <Chip ok={false}>{directResult.status} {directResult.json?._meta?.stage}</Chip>)}
                      {directResult && <div className="wi-claims" data-testid="direct-log">{directResult.json?._meta?.log}</div>}
                      {directResult?.status === 200 && <div data-testid="direct-tool-list">{(directResult.json?.result?.tools || []).map(t => t.name).join(', ')}</div>}
                    </div></div>
                  <div className="wi-step"><span className="wi-step-num">3</span>
                    <div><strong>Direct whoami</strong> — raw claims, no gateway enrichment.
                      {directWhoami && (directWhoami.status === 200 ? <Chip ok>200</Chip> : <Chip ok={false}>{directWhoami.status}</Chip>)}
                      {directWhoami?.status === 200 && <DirectWhoamiPane response={directWhoami.json} />}
                    </div></div>
                  <div className="wi-break">
                    <h3>Break it</h3>
                    <div className="wi-actions">
                      <button type="button" data-testid="break-tampered" onClick={() => breakIt('tampered')} disabled={busy}>Tampered token → direct door</button>
                      <button type="button" data-testid="break-escalate" onClick={() => breakIt('escalate')} disabled={busy}>Scope escalation → direct door</button>
                    </div>
                    {breakResult?.tampered && (breakResult.tampered.status === 401
                      ? <p className="wi-break-outcome" data-testid="break-tampered-outcome">
                          <Chip ok={false}>401 {breakResult.tampered.json?._meta?.stage}</Chip>{' '}
                          rejected at the signature check only — the direct backend still verifies what signs the token, nothing else.
                        </p>
                      : <p className="wi-break-outcome" data-testid="break-tampered-outcome"><Chip ok={false}>{breakResult.tampered.status}</Chip> unexpected</p>)}
                    {breakResult?.escalated && (breakResult.escalated.status === 200
                      ? <p className="wi-break-outcome" data-testid="break-escalate-outcome">
                          <Chip ok>200 executed</Chip>{' '}
                          the backend ran <code>GrantAdminTool</code> for a token minted with scope <code>federated:admin</code> — the gateway grant has no such scope and would refuse this. Ungoverned does not mean unsigned; it means unmanaged.
                        </p>
                      : <p className="wi-break-outcome" data-testid="break-escalate-outcome"><Chip ok={false}>{breakResult.escalated.status}</Chip> unexpected</p>)}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="wi-card">
            <h2>The token (raw, education)</h2>
            {token
              ? (tokenHeld
                ? <p className="muted" data-testid="token-held">The real token stays on the server and is never shown here. The decoded claims below are what the gateway checks.</p>
                : <JwtBox value={token} testId="raw-token" />)
              : <p className="muted">Press Run to mint one.</p>}
            {claims && (
              <>
                <h3>Decoded claims</h3>
                <JsonPane value={claims} testId="claims-view" label="IdP token claims" hot={CLAIMS_HOT} />
              </>
            )}
          </div>

          <div className="wi-card" data-testid="comparison-card">
            <h2>What the direct path misses</h2>
            <p className="muted">
              The direct path is an agent calling the backend with no gateway in between — in production that is
              exactly what happens when an agent holds a token for the backend directly. The gateway path is what
              you add to govern it. Both lanes here are in-process mocks; nothing real is called.
            </p>
            <div className="lab-table-wrap">
            <table className="lab-table">
              <thead><tr><th>Control</th><th>Privilege gateway</th><th>Direct (no gateway)</th></tr></thead>
              <tbody>
                <tr><td>Grant enforcement</td><td>3 tools granted</td><td>all 5 tools, incl. GrantAdminTool and DeleteAllTool</td></tr>
                <tr><td>Audience binding</td><td>bound to the door (<code>aud</code> must match)</td><td>whatever <code>aud</code> the token carries</td></tr>
                <tr><td>Required claims</td><td><code>act.sub</code> + <code>client_id</code> pinned</td><td>none</td></tr>
                <tr><td>Pass Agent Token</td><td>forwarded and verified end to end</td><td>the backend verifies the token itself, that is all</td></tr>
                <tr><td>Audit</td><td>per-call log line in the gateway</td><td>backend log only</td></tr>
              </tbody>
            </table>
            </div>
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
            <div className="lab-table-wrap">
            <table className="lab-table" data-testid="kinds-table">
              <thead><tr><th>Kind</th><th>Credential</th><th>Gateway check</th></tr></thead>
              <tbody>
                <tr><td>Virtual key (Agent Registry)</td><td>secret string</td><td>lookup + scope + owner</td></tr>
                <tr><td>Workload identity</td><td>JWT from the caller's own platform</td><td>signature vs registered JWKS, iss/aud/claims</td></tr>
              </tbody>
            </table>
            </div>
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
            <div className="lab-table-wrap">
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
            </div>
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
                  In Mock mode nothing leaves this page, so these runs leave nothing in Privilege. Click{' '}
                  <strong>Run through Privilege (Real)</strong> to send the same four steps to the real gateway (the first time it
                  asks for the PingFederate client secret). The setup guide is <code>privilege/GATEWAY-WORKLOAD-IDENTITY-SETUP.md</code> in AI-DEMO2.
                </p>
              )}
          </div>
        </section>
      </main>
    </div>
  );
}

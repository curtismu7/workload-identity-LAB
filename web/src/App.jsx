import React, { useEffect, useState, useCallback } from 'react';
import TopMenu, { applyFontSize } from './top-menu/TopMenu.jsx';
import TalkTrackDialog from "./talk-track/TalkTrackDialog.jsx";
import talkMd from "../../docs/talk-track.md?raw";
import VerifyMark from './components/VerifyMark.jsx';
import Diagram from './components/Diagram.jsx';
import JsonPane from './components/JsonPane.jsx';
import JwtBox from './components/JwtBox.jsx';
import GatewayTrace from './components/GatewayTrace.jsx';
import RunObservability from './run-observability/RunObservability.jsx';

const api = async (path, body, extraHeaders = {}) => {
  const res = await fetch(path, body === undefined
    ? { headers: extraHeaders }
    : { method: 'POST', headers: { 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};

// The gateway's lifetime check reads `exp`; iss, aud, sub, act, client_id and scope (its other checks) are hot by default.
const CLAIMS_HOT = ['exp'];

// Where each product's logs live and where they stream (rule 27). This lab reads no logs; the README says the same.
const OBS_STREAMS = [
  { product: 'PingFederate', lives: 'container stdout (only server.log and init.log reach stdout; audit.log is not shipped)', streams: 'the collector to ping-logs-pingfederate, then a SIEM' },
  { product: 'Privilege agent gateway', lives: 'cyonproxy.log in its log volume (local), or the SIEM index ping-siem-events-v2 (hosted)', streams: 'the collector file source to ping-logs-privilege-gateway, then the Privilege SIEM export' },
  { product: 'this lab', lives: 'one stdout line per gateway decision, with the same time as its row', streams: 'not shipped by this lab' },
];

// One id per Run press; the server keeps this run's record under it (letters, digits and hyphens).
const newRunId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

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
  const [talkOpen, setTalkOpen] = useState(false);
  const talkSteps = (() => {
    const steps = []; let n = 0;
    for (const line of talkMd.split("\\n")) {
      const m = line.match(/^\d+\.\s+\*\*(.+?)\.\*\*\s*(.*)$/);
      if (m) { n += 1; steps.push({ id: `s${n}`, title: m[1], say: m[2] }); }
    }
    return steps.length ? steps : [{ id: "s1", title: "Talk track", say: talkMd.slice(0, 600) }];
  })();
  const [fontSize, setFontSize] = useState('M');
  const [mode, setModeState] = useState('mock');
  const [scope, setScope] = useState(MOCK_SCOPE);
  const [corrupt, setCorrupt] = useState('');
  const [claims, setClaims] = useState(null);
  const [token, setToken] = useState(null);
  const [tokenHeld, setTokenHeld] = useState(false); // Real mode: the token stays on the server
  const [rawToken, setRawToken] = useState(null); // Real mode, only when the server runs with WI_SHOW_REAL_TOKEN=1
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
  const [notice, setNotice] = useState(''); // a true statement about the run that is not an error (a wrong-audience case that was not wrong)
  const [showConnect, setShowConnect] = useState(false); // the Real button's form
  const [form, setForm] = useState({ gatewayUrl: '', pfUrl: '', clientId: '', clientSecret: '' });
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');
  const [record, setRecord] = useState(null); // this run's record (rule 27), read back from the server
  const [recordError, setRecordError] = useState('');

  const loadRuns = useCallback(async () => {
    const { json } = await api('/api/runs');
    setRuns(json.runs || []);
  }, []);

  useEffect(() => {
    api('/api/info').then(({ json }) => {
      setInfo(json); setModeState(json.source);
      // Opened while the server is already in Real mode: the box shows the Real scopes, not the Mock default (never a value already typed)
      if (json.source === 'real' && json.real?.scopes) setScope(cur => (cur === MOCK_SCOPE ? json.real.scopes : cur));
    });
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
  const clearResults = () => { setClaims(null); setToken(null); setTokenHeld(false); setRawToken(null); setGatewayResult(null); setWhoami(null); setControl(null); setTraces([]); setDirectResult(null); setDirectWhoami(null); setBreakResult(null); setRecord(null); setRecordError(''); };

  // The run's record, in the page's current mode. A non-record answer is an alert, never the empty state.
  const loadRecord = async (id) => {
    try {
      const { status, json } = await api(`/api/observability/${encodeURIComponent(id)}`);
      // The record's runId is masked by the shared masker (a UUID), so only its shape is checked here; the page clears the record on every Run.
      if (status === 200 && json && typeof json.runId === 'string' && Array.isArray(json.rows)) { setRecord(json); setRecordError(''); return; }
      setRecord(null); setRecordError(json?.message || `The run record could not be read (HTTP ${status}).`);
    } catch {
      setRecord(null); setRecordError('The run record could not be read.');
    }
  };

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
  // A saved secret is shown masked; the page never has it. Change reopens the form, a blank secret keeps the saved one.
  const savedHint = (info?.realSource === 'saved' || info?.realSource === 'memory') && info?.realSecret?.set
    ? `•••••• saved${info.realSecret.ends ? ` (ends ${info.realSecret.ends})` : ''}` : null;
  const changeConnection = () => { setForm({ ...info.realForm, clientSecret: '' }); setConnectError(''); setShowConnect(true); };
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
    setBusy(true); setError(''); setNotice('');
    setClaims(null); setToken(null); setTokenHeld(false); setRawToken(null); setGatewayResult(null); setWhoami(null); setControl(null); setTraces([]); setDirectResult(null); setDirectWhoami(null); setBreakResult(null); setRecord(null); setRecordError('');
    // The gateway path is recorded (rule 27); the direct comparison is not, so it sends no run id.
    const runId = pathToUse === 'direct' ? null : newRunId();
    const idOnly = runId ? { 'x-run-id': runId } : {};
    const stepHeaders = (step) => (runId ? { 'x-run-id': runId, 'x-run-step': step } : {});
    const addTrace = (step, title, r) => {
      if (r.json?._meta?.trace) setTraces(prev => [...prev, { step, title, status: r.status, trace: r.json._meta.trace }]);
    };
    try {
      // Step 1: mint
      const mint = await api('/api/idp/token', { scope: scopeToUse, corrupt: corrupt || undefined }, idOnly);
      if (mint.status !== 200) {
        // Real mode: PingFederate (or the config) said no. Name it and stop; there is no token to send.
        const why = mint.json.message || `The token request failed (HTTP ${mint.status})`;
        setError(why);
        await logRun('1 mint', false, why);
        return;
      }
      setToken(mint.json.token);
      setNotice(mint.json.notice || '');
      setTokenHeld(Boolean(mint.json.held));
      setRawToken(mint.json.rawToken || null);
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
        { authorization: `Bearer ${mint.json.token}`, ...stepHeaders('gateway-tools-list') });
      setGatewayResult({ status: gw.status, json: gw.json });
      addTrace(2, 'Gateway check: tools/list', gw);
      await logRun('2 tools/list', gw.status === 200, gw.status === 200
        ? `accepted: ${gw.json._meta?.log}`
        : `refused (${gw.json._meta?.stage}): ${gw.json._meta?.detail}`);
      // Step 3: whoami passthrough
      const w = await api('/api/gateway/federated-rs/mcp',
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'whoami', arguments: {} } },
        { authorization: `Bearer ${mint.json.token}`, ...stepHeaders('gateway-passthrough') });
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
        { authorization: 'Bearer garbage-token-not-real', ...stepHeaders('gateway-control') });
      setControl(c.status);
      addTrace(4, 'Control: garbage bearer', c);
      await logRun('4 control', c.status === 401, `garbage bearer -> ${c.status}`);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      if (runId) await loadRecord(runId);
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
    <>
      <header className="shell-bar">
        <span className="shell-brand">
          <span className="shell-logo" aria-hidden="true">WI</span>
          Workload Identity Lab
          <span className={`shell-badge${mode === 'real' ? ' shell-badge--real' : ''}`} data-testid="mode-badge">{mode === 'real' ? 'Real' : 'Mock'}</span>
        </span>
        <nav className="shell-nav" aria-label="Lab">
          <a href="./" aria-current="page" data-testid="nav-lab">Federated agents</a>
        </nav>
        <TopMenu
          postman={{ repo: "curtismu7/workload-identity-LAB", slug: "workload-identity-lab" }}
          mode={{ value: mode, onChange: switchMode, realAvailable: info?.realAvailable, realHint: 'Click “Run through Privilege (Real)” on the page to connect first' }}
          theme={{ value: theme, onChange: setTheme }}
          talkTrack={{ active: talkOpen, onToggle: () => setTalkOpen((v) => !v) }}
          fontSize={{ value: fontSize, onChange: setFontSize }}
          help={{ href: 'https://github.com/curtismu7/workload-identity-LAB#readme' }}
          version="v0.1.0"
          onReset={reset}
        >
          <VerifyMark id="workload-identity-lab" />
        </TopMenu>
      </header>
      <main className="lab-main">
        <div className="sim-banner" data-testid="sim-banner">
          {mode === 'mock'
            ? 'SIMULATED — the IdP, gateway and MCP backend on this page are in-process mocks; no real system is called. Mock-issued tokens are labelled.'
            : `REAL — the token is minted by ${info?.real?.pfHost || 'PingFederate'} and every call goes to the Privilege gateway at ${info?.real?.gatewayHost || 'the configured host'}. The client secret stays on the server and is never sent to the browser.`}
        </div>
        <h1>Federated agents: workload identity through the gateway</h1>
        <p className="lab-lead">
          The agent holds <strong>no gateway secret</strong>. Its own identity platform vouches for it
          with a signed JWT; the gateway verifies that vouching (issuer JWKS, audience, required claims)
          and forwards the identity to the backend. Same grant/policy machinery as Agent Registry keys —
          but the credential comes from outside.
        </p>
        {error && <div className="lab-error" role="alert" data-testid="mode-error">{error}</div>}
        {notice && <div className="sim-banner" role="note" data-testid="mint-notice">{notice}</div>}

        <section className="wi-grid">
          <div className="duo">
          <div className="wi-card">
            <h2><span className="step-num" aria-hidden="true">1</span>Run the flow</h2>
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
            {/* The connect form takes the place of the Run actions while it is open: one primary button at a time */}
            {showConnect ? (
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
                    placeholder={savedHint ? `${savedHint}, leave blank to keep it` : undefined}
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
            ) : (
              <div className="wi-actions">
                <button className="primary" data-testid="run-btn" onClick={() => runDemo()} disabled={busy}>
                  {busy ? 'Running…' : 'Run'}
                </button>
                <button type="button" data-testid="real-btn" onClick={runReal} disabled={busy || connecting}>
                  Run through Privilege (Real)
                </button>
              </div>
            )}
            {info?.realAvailable && info.real && (
              <p className="muted wi-real-status" data-testid="real-status">
                Connected: {info.real.pfHost} → {info.real.gatewayHost}, client {info.real.clientId}.{' '}
                {CONNECTION_NOTE[info.realSource]}
                {savedHint && <> <span data-testid="real-secret-hint">Client secret: {savedHint}.</span></>}
                {(info.realSource === 'saved' || info.realSource === 'memory') && (
                  <> <button type="button" className="wi-forget" data-testid="real-change" onClick={changeConnection} disabled={busy || connecting}>Change</button>
                    {' '}<button type="button" className="wi-forget" data-testid="real-forget" onClick={forget}>Forget the saved connection</button></>
                )}
              </p>
            )}
            <div className="wi-steps">
              <div className="wi-step"><span className="wi-step-num">1</span>
                <div><strong>Mint</strong> — the IdP issues a JWT for the agent.
                  {claims && <Chip ok>{claims.iss || claims.note}</Chip>}
                  {rawToken && <JwtBox value={rawToken} testId="real-token" label="The JWT as minted by the IdP" />}</div></div>
              <div className="wi-step"><span className="wi-step-num">2</span>
                <div><strong>Gateway check</strong> — <code>tools/list</code> with the JWT.
                  {gatewayResult && (gwOk ? <Chip ok>200 accepted</Chip> : <Chip ok={false}>{gatewayResult.status} {gatewayResult.json?._meta?.stage}</Chip>)}
                  {gatewayResult && <div className="wi-claims" data-testid="gateway-log">{gatewayResult.json?._meta?.log}</div>}
                  {gwOk && (
                    <div className="wi-tools-box">
                      <div className="wi-tools-label">Tools returned ({(gatewayResult.json?.result?.tools || []).length})</div>
                      <div data-testid="tool-list">{(gatewayResult.json?.result?.tools || []).map(t => t.name).join(', ')}</div>
                    </div>
                  )}
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
          </div>

          <div className="wi-card">
            <h2><span className="step-num" aria-hidden="true">2</span>The token (raw, education)</h2>
            {token
              ? (tokenHeld
                ? <p className="muted" data-testid="token-held">{rawToken ? 'The real token is shown in step 1 (demo flag). ' : 'The real token stays on the server and is never shown here. '}The decoded claims below are what the gateway checks.</p>
                : <JwtBox value={token} testId="raw-token" />)
              : <p className="muted">Press Run to mint one.</p>}
            {claims && (
              <>
                <h3>Decoded claims</h3>
                <JsonPane value={claims} testId="claims-view" label="IdP token claims" hot={CLAIMS_HOT} />
              </>
            )}
          </div>

          <div className="wi-card wi-card-wide" data-testid="comparison-card">
            <h2><span className="step-num" aria-hidden="true">3</span>What the direct path misses</h2>
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
            <h2><span className="step-num" aria-hidden="true">4</span>Gateway trace</h2>
            <GatewayTrace exchanges={traces} source={mode} />
          </div>

          <div className="wi-card wi-card-wide">
            {recordError && <div className="lab-error" role="alert" data-testid="obs-error">{recordError}</div>}
            {record && <RunObservability record={record} source={mode} streams={OBS_STREAMS} />}
            {!record && !recordError && <p className="muted">Press Run to record what each layer logged for the run.</p>}
            <p className="muted">Counts are rows, not calls. The record covers the four gateway steps of Run the flow; the direct comparison and Break it are not recorded.</p>
          </div>

          <div className="duo">
          <div className="wi-card">
            <h2><span className="step-num" aria-hidden="true">5</span>Run log</h2>
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
            <h2><span className="step-num" aria-hidden="true">6</span>Two ways an agent identifies</h2>
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
            <h2><span className="step-num" aria-hidden="true">7</span>The hop chain</h2>
            <Diagram diagramId="workload-identity-flow" theme={theme === 'auto' ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme} />
          </div>

          <div className="wi-card wi-card-wide" data-testid="privilege-proof">
            <h2><span className="step-num" aria-hidden="true">8</span>Show it in Privilege</h2>
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
          </div>
        </section>
      </main>
      <TalkTrackDialog isOpen={talkOpen} onClose={() => setTalkOpen(false)} talk={talkSteps} />
    </>
  );
}


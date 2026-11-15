import React from 'react';
import JsonPane from './JsonPane.jsx';
import './gateway-trace.css';

/*
  "What Privilege did": for each call an app makes to the Privilege gateway, the exact request, the exact
  response, and the decisions the gateway made in between. Built to be reused by every Privilege demo:
  it needs only this data and the tokens in standalone-ui.css (no app classes).

  <GatewayTrace exchanges={[{ step: 2, title: 'Gateway check: tools/list', status: 200, trace }]} />

  trace = {
    source: 'mock' | 'real',
    request:  { method, url, headers, body },
    response: { status, headers, body } | null,            // null: the gateway was never reached
    decisions: [{ id, label, outcome: 'pass'|'fail'|'skipped'|'info',
                  basis: 'checked'|'inferred'|'observed', evidence }],
    record: string | null,                                  // where the gateway itself records this call
    at?, requestId?                                         // to find that record
  }

  basis: 'checked' = the simulation computed it; 'observed' = read from the response; 'inferred' = the real
  gateway returns no per-check detail, so it is read from the outcome and labelled as such. Never present an
  inferred decision as if the gateway had reported it.
*/

const OUTCOME_LABEL = { pass: 'PASS', fail: 'FAIL', skipped: 'NOT REACHED', info: 'INFO' };
const BASIS_NOTE = { inferred: 'inferred from the outcome', observed: 'observed in the response' };

// What matters in THIS lab's gateway payloads: the JSON-RPC method and tool, which check refused (stage, detail), the tool list,
// and the claims the backend received (unchanged = the Pass Agent Token verdict). Rule 24 defaults (sub, act, aud, scope, ...) are already hot.
const GW_HOT = ['method', 'name', 'tools', 'stage', 'detail', 'receivedClaims', 'unchanged'];

const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const clip = (s, n = 6000) => (s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more characters not shown)` : s);
const headerLines = (h) => Object.entries(h || {}).map(([k, v]) => `${k}: ${v}`);

export const requestText = (r) => [`${r.method} ${r.url}`, ...headerLines(r.headers), '', asText(r.body)].join('\n');
export const responseText = (r) => [`HTTP ${r.status}`, ...headerLines(r.headers), '', asText(r.body)].join('\n');

function Exchange({ ex }) {
  const t = ex.trace;
  const counted = t.decisions.filter(d => d.outcome !== 'info');
  const failed = t.decisions.find(d => d.outcome === 'fail');
  const summary = failed ? `refused at: ${failed.label}` : `all ${counted.length} decisions passed`;
  return (
    <details className="gw-ex" open data-testid={`trace-${ex.step}`}>
      <summary>
        <span className="gw-num">{ex.step}</span>
        <strong>{ex.title}</strong>
        {ex.status != null && <span className="gw-chip" data-outcome={ex.status < 400 ? 'pass' : 'fail'}>HTTP {ex.status}</span>}
        <span className="gw-sum">{summary}</span>
      </summary>

      <h4>Decisions the gateway made</h4>
      <ol className="gw-decisions" data-testid={`trace-${ex.step}-decisions`}>
        {t.decisions.map(d => (
          <li key={d.id} data-outcome={d.outcome}>
            <span className="gw-chip" data-outcome={d.outcome}>{OUTCOME_LABEL[d.outcome] || d.outcome}</span>
            <div>
              <strong>{d.label}</strong> <span className="gw-evidence">{d.evidence}</span>
              {BASIS_NOTE[d.basis] && <span className="gw-tag">{BASIS_NOTE[d.basis]}</span>}
            </div>
          </li>
        ))}
      </ol>

      <div className="gw-io">
        <div>
          <h4>Request sent to the gateway</h4>
          <div className="gw-pre" data-testid={`trace-${ex.step}-request`}><JsonPane value={clip(requestText(t.request))} label="Request sent to the gateway" hot={GW_HOT} /></div>
        </div>
        <div>
          <h4>Response from the gateway</h4>
          {t.response
            ? <div className="gw-pre" data-testid={`trace-${ex.step}-response`}><JsonPane value={clip(responseText(t.response))} label="Response from the gateway" hot={GW_HOT} /></div>
            : <p className="gw-muted" data-testid={`trace-${ex.step}-response`}>No response: the gateway could not be reached.</p>}
        </div>
      </div>

      {t.record && (
        <p className="gw-muted gw-record">
          <strong>{t.source === 'real' ? 'The gateway\'s own record' : 'The gateway log line this call produces'}:</strong>{' '}
          {t.record}
          {(t.at || t.requestId) && <> Time {t.at}{t.requestId ? `, request ${t.requestId}` : ''}.</>}
        </p>
      )}
    </details>
  );
}

export default function GatewayTrace({ exchanges, source }) {
  return (
    <section className="gw-trace" data-testid="gateway-trace" aria-label="What Privilege did">
      <h2>What Privilege did</h2>
      <p className="gw-lead">
        Every request the agent sent to the Privilege gateway, exactly what came back, and the decisions the gateway
        made in between.
      </p>
      <p className="gw-muted" data-testid="gateway-trace-basis">
        {source === 'real'
          ? 'Real gateway. The requests and responses are exact. The gateway answers with a status and a body, not a per-check breakdown, so decisions marked "inferred" are read from the outcome; the gateway log is the authoritative record.'
          : 'Simulated: the lab\'s in-process gateway runs the same checks in the same order, so these decisions are what it computed. Real mode shows the actual gateway.'}
      </p>
      {exchanges.length === 0
        ? <p className="gw-muted" data-testid="gateway-trace-empty">Press Run: each request, each response and each decision appears here.</p>
        : exchanges.map(ex => <Exchange key={ex.step} ex={ex} />)}
    </section>
  );
}

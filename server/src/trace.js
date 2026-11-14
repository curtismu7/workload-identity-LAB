// "What the gateway did": one record per gateway call (exact request, exact response, the decisions),
// for the page's trace panel. The shape is the contract of web/src/components/GatewayTrace.jsx:
//   { source: 'mock'|'real', request: {method, url, headers, body}, response: {status, headers, body}|null,
//     decisions: [{ id, label, outcome: 'pass'|'fail'|'skipped'|'info', basis: 'checked'|'inferred'|'observed', evidence }],
//     record: string|null, at?, requestId? }
// Nothing secret goes in: the Authorization header is shown shortened, or not at all for a real token.

export function bearerForDisplay(bearer, resolve = (b) => b) {
  const actual = String(resolve(bearer));
  if (actual !== bearer) return `Bearer <PingFederate JWT, ${actual.length} characters, kept on the server>`; // a real token
  if (bearer.split('.').length === 3) return `Bearer ${bearer.slice(0, 20)}… (${bearer.length} characters, shortened)`; // a mock JWT
  return `Bearer ${bearer}`; // a typed value, such as the garbage control
}

const sent = (bearerLine) => ({ authorization: bearerLine, 'content-type': 'application/json', accept: 'application/json, text/event-stream' });

export function mockTrace({ app, token, rpc, out }) {
  return {
    source: 'mock',
    request: { method: 'POST', url: `https://gateway.workload-lab.invalid/${app}/mcp`, headers: sent(bearerForDisplay(token)), body: rpc },
    response: { status: out.http, headers: { 'content-type': 'application/json' }, body: out.body },
    decisions: out.decisions,
    record: out.log,
  };
}

const inferred = (id, label, outcome, evidence) => ({ id, label, outcome, basis: 'inferred', evidence });

// The real gateway answers with a status and a body, not a per-check breakdown. So the checks are
// INFERRED from the outcome (and labelled so); the exact request/response are observed.
function realDecisions(rpc, out, unchanged) {
  const d = [];
  const toolNames = (out.body?.result?.tools || []).map(t => t.name);
  if (out.status === 200) {
    d.push(inferred('authenticated', 'Authentication', 'pass', 'token accepted. HTTP 200: before answering, the gateway verified the signature against the issuer\'s registered JWKS, then the issuer, audience, required claims and lifetime.'));
    d.push(inferred('grant', 'Grant', 'pass', rpc.method === 'tools/list'
      ? (toolNames.length ? `the agent key's grant allows ${toolNames.length} tools on this app: ${toolNames.join(', ')}` : 'the agent key may use this app (it returned no tools)')
      : `the agent key's grant allows ${rpc.params?.name || rpc.method}`));
    if (unchanged !== undefined) {
      d.push({
        id: 'forward', label: 'Pass Agent Token', basis: 'observed',
        outcome: unchanged === true ? 'pass' : unchanged === false ? 'fail' : 'info',
        evidence: unchanged === true ? "the backend's whoami reply reports the same iss, sub, iat and exp as the token that was minted"
          : unchanged === false ? "the backend's whoami reply reports different claims than the token that was minted"
            : 'the backend answered, but its reply had no claims to compare',
      });
    }
  } else if (out.status === 401) {
    d.push(inferred('authenticated', 'Authentication', 'fail', `token refused. HTTP 401${out.stage ? ` (${out.stage})` : ''}: the gateway's reply does not say which check failed; the gateway log line "workload token rejected: <reason>" does.`));
    d.push(inferred('grant', 'Grant', 'skipped', 'not reached: the token was refused'));
  } else if (out.status === 403) {
    d.push(inferred('authenticated', 'Authentication', 'pass', 'token accepted. HTTP 403 is answered after authentication.'));
    d.push(inferred('grant', 'Grant', 'fail', out.detail || 'no grant rule on the agent key matched this app or tool'));
  } else {
    d.push({ id: 'status', label: `HTTP ${out.status}`, outcome: 'info', basis: 'observed', evidence: out.detail || 'an unexpected answer from the gateway' });
  }
  return d;
}

const RECORD = {
  200: 'Look for: workload token accepted for key <key> issuer=<iss> subject=<sub>, with no "policy denied" beside it.',
  401: 'Look for: workload token rejected: <reason>. The reason names the check that failed.',
  403: 'Look for: policy denied (the token was accepted; the grant did not allow the call).',
};

export function realTrace({ url, bearer, resolve, rpc, out, unchanged }) {
  return {
    source: 'real',
    request: { method: 'POST', url, headers: sent(bearerForDisplay(bearer, resolve)), body: rpc },
    response: { status: out.status, headers: out.headers, body: out.body },
    decisions: realDecisions(rpc, out, unchanged),
    record: RECORD[out.status] || null,
    at: out.at,
    requestId: out.requestId,
  };
}

// The gateway could not be reached at all: there is a request, but no response and no decision to show.
export function realFailureTrace({ url, bearer, resolve, rpc, error }) {
  return {
    source: 'real',
    request: { method: 'POST', url, headers: sent(bearerForDisplay(bearer, resolve)), body: rpc },
    response: null,
    decisions: [{ id: 'reach', label: 'Reach the gateway', outcome: 'fail', basis: 'observed', evidence: error }],
    record: null,
  };
}

// This lab's run record (rule 27). Each event is stamped ONCE, stored on its run, and the same
// timestamp is written on the one stdout line a gateway decision gets. The record is built from the
// stored events by the shared collectRun; nothing is re-run to make it.
//   Mock: rows are 'simulated' (the lab's mock computed them).
//   Real: rows are 'response' (the reply the lab got from PingFederate or the gateway). This lab reads no logs.
import { createRunObservability } from './runObservability.js';

const LAB = 'workload-identity-lab';
const RUN_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const STEPS = new Set(['gateway-tools-list', 'gateway-passthrough', 'gateway-control']);
const LABEL = { 'gateway-tools-list': 'tools/list', 'gateway-passthrough': 'whoami passthrough', 'gateway-control': 'control' };
const RESULT = { allowed: 'passed', refused: 'stopped', info: 'unclear', 'no-reply': 'no-reply' };
const CAP_PER_MODE = 20;

const runs = new Map(); // `${mode}|${runId}` -> { id, mode, startedAt, events: [], open: true }
let writeLine = (line) => console.log(line);

// Tests swap the writer; the default writes one line to stdout.
export function setDecisionWriter(fn) { writeLine = fn; }

export const validRunId = (id) => typeof id === 'string' && RUN_ID_RE.test(id);
export const stepFrom = (h) => (STEPS.has(h) ? h : 'gateway-call');
const clean = (v) => String(v ?? '').replace(/[^A-Za-z0-9._:/@-]/g, '').slice(0, 80) || '-';
const keyOf = (mode, id) => `${mode}|${id}`;

function startRun(mode, id) {
  const key = keyOf(mode, id);
  if (runs.has(key)) return runs.get(key);
  const inMode = [...runs.values()].filter((r) => r.mode === mode);
  if (inMode.length >= CAP_PER_MODE) {
    const oldestClosed = [...runs.entries()].find(([, r]) => r.mode === mode && !r.open);
    if (!oldestClosed) return null; // every kept run is still open: never evict an open run
    runs.delete(oldestClosed[0]);
  }
  const run = { id, mode, startedAt: new Date().toISOString(), events: [], open: true };
  runs.set(key, run);
  return run;
}

// One stdout line per gateway decision. A throwing writer drops this one line and nothing else.
function decide({ at, step, result, runId }) {
  try {
    writeLine(`${at} ${LAB} decision step=${clean(step)} actor=${clean(LAB)} result=${result} run=${clean(runId)}`);
  } catch (e) {
    console.error(`run-log: decision line not written (${e?.code || 'error'})`);
  }
}

// Record one event. `runId` is the caller's header value; an invalid one begins no run (no row).
function note({ runId, mode, layer, outcome, message, step, decision }) {
  const at = new Date().toISOString();
  const run = validRunId(runId) ? startRun(mode, runId) : null;
  // A call that got no reply is no row: only its decision line says so.
  if (run && outcome !== 'no-reply') run.events.push({ at, layer, outcome, message });
  if (run && step === 'gateway-control') run.open = false;
  if (decision) decide({ at, step, result: RESULT[outcome] ?? 'unclear', runId: run ? runId : '-' });
  return run;
}

// A mint (issuance) is info: it is a credential check, never an allow or a refusal.
export function recordMint({ runId, mode, message }) {
  if (runId === undefined) return; // not part of a run
  note({ runId, mode, layer: 'agent', outcome: 'info', message });
}

// A gateway reply is a policy decision (allowed or refused) only when the status says so; any other status is info.
function gatewayOutcome(status, body) {
  if (status === 401 || status === 403) return 'refused';
  if (status === 200 && (body?.error || body?.result?.isError)) return 'refused';
  if (status === 200) return 'allowed';
  return 'info';
}

const MESSAGE = {
  allowed: (label, status) => `The gateway let the ${label} call through (HTTP ${status})`,
  refused: (label, status) => `The gateway refused the ${label} call (HTTP ${status})`,
  info: (label, status) => `The gateway answered the ${label} call with HTTP ${status}; that is not a policy decision`,
};

// The gateway's reply to one call of the run. `step` names the call; `app` is the gateway app it went to.
export function recordGatewayReply({ runId, mode, step, app, status, body }) {
  if (runId === undefined) return;
  const label = LABEL[step] ?? 'gateway';
  const outcome = gatewayOutcome(status, body);
  note({ runId, mode, layer: 'gateway', outcome, message: MESSAGE[outcome](label, status), step, decision: true });
  if (mode === 'mock' && app === 'federated-rs' && status === 200) {
    note({ runId, mode, layer: 'resource', outcome: 'info', message: `The mock backend answered the ${label} call` });
  }
}

// The gateway did not answer (no connection or a timeout): no row, and the decision line says no-reply.
export function recordGatewayNoReply({ runId, mode, step }) {
  if (runId === undefined) return;
  note({ runId, mode, layer: 'gateway', outcome: 'no-reply', message: '', step, decision: true });
}

export function hasRun(mode, id) { return runs.has(keyOf(mode, id)); }

export function clearRuns() { runs.clear(); }

const NOT_LOGGED = {
  person: 'This lab signs no person in: the agent authenticates as itself, so there is no person to log.',
  authorize: 'This lab does not call PingOne Authorize, so there is no Authorize decision to show.',
  privilege: 'The gateway answers one reply per call and this lab does not read the Privilege policy log, so the gateway answer is shown under Agent gateway.',
};

// Build the record for one run in one mode. Null when this mode holds no such run.
export async function recordFor(mode, id) {
  const run = runs.get(keyOf(mode, id));
  if (!run) return null;
  const rowsOf = (layer) => run.events.filter((e) => e.layer === layer).map(({ at, outcome, message }) => ({ at, outcome, message }));
  const spec = (layer) => {
    const rows = rowsOf(layer);
    const reason = layer === 'resource' && mode === 'real'
      ? 'This lab does not read the MCP backend log. Its answer comes back through the gateway call, shown under Agent gateway.'
      : layer === 'agent' ? 'No token was issued for this run.'
        : layer === 'gateway' ? 'No gateway call of this run got a reply.'
          : layer === 'resource' ? 'The MCP backend was not reached for this run.'
            : NOT_LOGGED[layer];
    if (mode === 'real') return { layer, products: [], reason, responses: rows };
    return { layer, products: [], reason, simulated: rows };
  };
  const layers = ['person', 'agent', 'authorize', 'privilege', 'gateway', 'resource'].map(spec);
  const obs = createRunObservability({ readers: [] });
  return obs.collectRun({
    runId: id,
    startedAt: run.startedAt,
    endedAt: new Date().toISOString(),
    correlation: {},
    layers,
    source: mode === 'real' ? 'real' : 'mock',
  });
}

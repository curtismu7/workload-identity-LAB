// Rule 23: upstream failures are named, never blank. Any fetch to an upstream
// (real mode) goes through here: connection-refused/timeout/5xx become a
// structured { error, message } — never an HTML error page, a hang, or an empty 200.
export async function callUpstream(url, init = {}, { timeoutMs = 15000 } = {}) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw Object.assign(new Error(`upstream timeout after ${timeoutMs}ms: ${url}`), { code: 'upstream_timeout' });
    }
    if (e.cause?.code === 'ECONNREFUSED' || e.code === 'ECONNREFUSED') {
      throw Object.assign(new Error(`upstream unreachable (connection refused): ${url}`), { code: 'upstream_unreachable' });
    }
    if (e.cause?.code === 'ENOTFOUND') {
      throw Object.assign(new Error(`upstream DNS failure: ${url}`), { code: 'upstream_unreachable' });
    }
    throw Object.assign(new Error(`upstream network error (${e.message}): ${url}`), { code: 'upstream_error' });
  }
  if (res.status >= 502) {
    throw Object.assign(new Error(`upstream answered ${res.status}: ${url}`), { code: 'upstream_bad_gateway', status: res.status });
  }
  return res;
}

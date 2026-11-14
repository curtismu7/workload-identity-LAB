#!/usr/bin/env node
// Reset: clear the in-memory run log via the API, or print how to when unreachable.
const port = process.env.PORT || 7816;
try {
  const r = await fetch(`http://127.0.0.1:${port}/api/reset`, { method: 'POST' });
  console.log(r.ok ? '[reset] run log cleared' : `[reset] API answered ${r.status}`);
} catch {
  console.log(`[reset] app not reachable on ${port}; nothing to reset (state is in-memory only).`);
}

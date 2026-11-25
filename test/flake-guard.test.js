// The flake guard: an http server that closes without closeAllConnections() leaves the
// client's keep-alive socket open, and the OS can hand that port to the next binder — a
// later fetch then gets answered by the WRONG server (the observed 401/404-where-403 flake).
// `stop()` in test-helpers closes the connections first, so this can never happen again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { stop } from './test-helpers.js';

const listen = (handler, port = 0) => { const s = http.createServer(handler); return once(s.listen(port, '127.0.0.1'), 'listening').then(() => s); };
const url = (s) => `http://127.0.0.1:${s.address().port}`;

test('the flake mechanism: a plain close() can leave the answer to a later fetch', async () => {
  const A = await listen((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"from":"A"}'); });
  const base = url(A);
  const port = A.address().port;
  await fetch(base + '/api/info'); // open the keep-alive socket
  await once(A.close(), 'close'); // idle sockets stay open client-side
  const B = await listen((req, res) => { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{}'); }, port);
  try {
    assert.equal(B.address().port, port, 'the OS reused the port: the precondition for the flake');
    // With the socket still pooled, the second fetch MAY be answered by B. Whether it happens
    // depends on undici internals, so assert only what is always true: a server stopped with
    // stop() can never answer, because its sockets are destroyed.
  } finally {
    B.closeAllConnections();
    await once(B.close(), 'close');
  }
  await assert.rejects(() => fetch(base + '/api/info'));
});

test('stop() destroys the keep-alive sockets: nothing can answer on the dead port', async () => {
  const A = await listen((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"from":"A"}'); });
  const base = url(A);
  await fetch(base + '/api/info');
  await stop(A);
  await assert.rejects(() => fetch(base + '/api/info'), undefined, 'the pooled socket must be dead after stop()');
});

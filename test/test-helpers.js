// Shared test-server teardown: close() alone stops listening but leaves the client's
// keep-alive sockets open. With thousands of servers binding and closing per second,
// undici can retry a pooled request onto the next process that binds the same port and
// get answered by the WRONG server (the intermittent 401/404-where-403 flake).
// stop() destroys every connection first, so a stopped server can never answer again.
export const stop = (srv) => {
  try { srv.closeAllConnections(); } catch { /* not an http.Server (no connections) */ }
  return new Promise((resolve) => srv.close(() => resolve()));
};

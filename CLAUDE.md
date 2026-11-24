# workload-identity-LAB

Tester-tier lab: federated agents (workload identity) through a Privilege-style gateway.

## What it does
The agent holds no gateway secret. Its identity platform issues a JWT; the gateway
verifies signature (registered JWKS) → issuer → audience → required claims → lifetime,
then enforces the agent key's grant and forwards the token to the backend (Pass Agent Token).

## Run
- `docker compose up --build` → http://127.0.0.1:7816 (lab-proxy: https://local.ping-devops.com:8443/workload-identity/)
- Dev: `npm install`, `cd web && npm run build`, `PORT=7816 node server/src/index.js`
- Test: `npm test` (node --test, 37 tests; Real mode is tested against local fake PF + gateway); web: `cd web && npx vitest run` (17 tests)
- Doctor: `npm run doctor`; Reset: `npm run reset` or POST /api/reset

## Modes (rule 19)
Mock (default, zero outbound, netguard-proven) / Real (owner-only). The page's "Run through Privilege (Real)"
button connects: the form posts to /api/real/connect, which checks the client at PingFederate (as Real, so it is
tagged Real in netguard), then saves WI_REAL_* to /data/real-connection.json (mode 600, the `wi-real-config` volume;
server/src/realStore.js). A complete saved connection wins over the app .env (see .env.example, the alternative);
not connected -> 409 naming the missing ones. The secret is never in any response, log or the browser.
Real mints a real PingFederate token and
calls the real gateway server-side (server/src/realGateway.js); the secret and the real token
never reach the browser (the one exception is the opt-in demo flag `WI_SHOW_REAL_TOKEN=1`, off by default, which shows the minted token in step 1). Netguard tags each attempt with its mode, so Real runs never count
against the Mock zero-outbound proof. `.env` stays out of the image (.dockerignore).
Toggle lives in the TopMenu; POST /api/mode switches at runtime.

## Rules that bite here
- No EC generateKeyPairSync (rulebook); RSA only, and only for the MOCK issuer.
- Mock-issued tokens shown raw but labelled; no real credentials ever in the repo.
- Loopback-only bind, Host check, same-origin writes — see server/src/app.js.
- The vendored web/src/top-menu/* must stay byte-identical to AI-DEMO-Standalone/shared/top-menu (pin file beside it).
- Mock mode must keep netguard attempts at 0 — test-pinned.
- The "What each layer logged" panel (web/src/run-observability/, server/src/runObservability.js, scripts/run-observability-checkPin.mjs)
  is vendored from AI-DEMO-Standalone `shared/run-observability/`: never hand-edit it; change the canonical, then re-vendor. The lab
  reads no logs, so it does not set any RUN_OBS_ variable. The only files that carry a RUN_OBS_ name are the vendored core
  server/src/runObservability.js (its reader-setup message), and the vendored panel test files web/src/run-observability/fixtures.js and
  web/src/run-observability/run-observability.test.jsx (their reason text); test/run-observability.test.js pins that list. The record is
  built in server/src/runLog.js.
- The "What Privilege did" panel (web/src/components/GatewayTrace.jsx; data built in server/src/trace.js) is the reusable
  request / response / decisions view for every Privilege demo; its data contract is the header of that file. The real gateway
  returns no per-check detail, so Real-mode decisions stay labelled `inferred` (or `observed`): never present a check the
  gateway did not report as if it had. Nothing secret goes in a trace (real token: not shown at all).

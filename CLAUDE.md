# workload-identity-LAB

Tester-tier lab: federated agents (workload identity) through a Privilege-style gateway.

## What it does
The agent holds no gateway secret. Its identity platform issues a JWT; the gateway
verifies signature (registered JWKS) → issuer → audience → required claims → lifetime,
then enforces the agent key's grant and forwards the token to the backend (Pass Agent Token).

## Run
- `docker compose up --build` → http://127.0.0.1:7816 (lab-proxy: https://local.ping-devops.com:8443/workload-identity/)
- Dev: `npm install`, `cd web && npm run build`, `PORT=7816 node server/src/index.js`
- Test: `npm test` (node --test, 11 tests)
- Doctor: `npm run doctor`; Reset: `npm run reset` or POST /api/reset

## Modes (rule 19)
Mock (default, zero outbound, netguard-proven) / Real (owner-only; needs
WI_REAL_GATEWAY_URL + WI_REAL_CLIENT_SECRET in .env; 409 with how-to when unset).
Toggle lives in the TopMenu; POST /api/mode switches at runtime.

## Rules that bite here
- No EC generateKeyPairSync (rulebook); RSA only, and only for the MOCK issuer.
- Mock-issued tokens shown raw but labelled; no real credentials ever in the repo.
- Loopback-only bind, Host check, same-origin writes — see server/src/app.js.
- The vendored web/src/top-menu/* must stay byte-identical to AI-DEMO-Standalone/shared/top-menu (pin file beside it).
- Mock mode must keep netguard attempts at 0 — test-pinned.

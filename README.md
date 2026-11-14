# Workload Identity Lab (Tester)

**Tier: Tester** — probes and demonstrates one mechanism: federated agents
(workload identity) through a Privilege-style gateway.

The story: an AI agent authenticates with a **JWT issued by its own identity
platform** (PingFederate, Kubernetes, GitHub Actions, any OIDC issuer). It holds
**no gateway secret at all**. The gateway verifies the token against the issuer's
registered JWKS, matches issuer/audience/required claims, enforces the agent key's
grant, and forwards the token unchanged to the backend (**Pass Agent Token**).

Mock mode runs the identical check chain in-process (zero outbound calls,
netguard-proven). Real mode (owner-configured) drives the actual SE PingFederate
and Privilege gateway.

## What the page shows
1. **Mint** — the IdP issues the agent's JWT (claims decoded on screen).
2. **Gateway check** — `tools/list` accepted → the gateway log line
   (`workload token accepted for key … issuer=… subject=…`).
3. **Pass Agent Token** — the backend's `whoami` reports the token unchanged.
4. **Control** — garbage bearer → 401.

Negative cases on purpose: flip a signature char (401 at the signature stage),
wrong audience — the classic "token served by the default token manager" mix-up
(401 at the audience stage).

## Run (Docker, OrbStack)
```bash
docker compose up --build
# → http://127.0.0.1:7816  (lab-proxy: https://local.ping-devops.com:8443/workload-identity/)
```

## Modes
- **Mock** (default): in-process IdP + gateway + MCP backend; netguard asserts zero outbound.
- **Real**: set `WI_REAL_GATEWAY_URL` and `WI_REAL_CLIENT_SECRET` in `.env` beside the compose
  file (mode 600, gitignored), restart, then toggle Real in the header. Unset → the toggle
  is disabled and `POST /api/mode {"source":"real"}` answers 409 with a how-to.

## The real-world reference
Verified live 2026-11-13 against SE PingFederate + Privilege (see AI-DEMO2
`privilege/GATEWAY-WORKLOAD-IDENTITY-SETUP.md`, merged PR #3583): PF-issued token
accepted by the gateway as a workload identity, backend received it unchanged,
wrong-audience and garbage tokens refused.

## Test
```bash
npm test          # node --test, 11 tests
npm run doctor    # presenter checks
npm run reset     # clear the run log
```

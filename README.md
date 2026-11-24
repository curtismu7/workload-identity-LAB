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

### Postman

`postman/workload-identity-lab.postman_collection.json` drives the hop chain without the UI: mint a federated token at the mock IdP (chained via the \`IDP_TOKEN\` collection variable), decode it (with the undecodable negative), call the mock MCP server through the gateway and direct, then read the run history and the netguard log. No environment needed — keys are in-process mocks on a `.invalid` issuer.

```
node ../../shared/postman/generator.mjs --spec postman/spec.json            # regenerate (never hand-edit the output)
npx newman run postman/workload-identity-lab.postman_collection.json
```

```bash
docker compose up --build
# → http://127.0.0.1:7816  (lab-proxy: https://local.ping-devops.com:8443/workload-identity/)
```

## Modes
- **Mock** (default): in-process IdP + gateway + MCP backend; netguard asserts zero outbound.
- **Real** (owner-run): the same four steps against the real PingFederate and the real
  Privilege gateway. Click **Run through Privilege (Real)**. The first time, a small form asks for the
  gateway URL, the PingFederate URL, the client ID and the client secret. **Connect and run** checks the
  client against PingFederate first (a wrong secret is named and nothing is saved), saves the connection,
  switches to Real and runs all four steps. After that the button just runs. The secret is saved in a
  mode-600 file on the `wi-real-config` Docker volume (`/data`), so it survives a restart; it is never in the
  repo, the image, the browser, an API response or a log. **Forget the saved connection** removes it. If the
  volume cannot be written the connection is kept in memory for that run and the page says so.
  Once saved, the page shows only `Client secret: •••••• saved (ends …abcd)` (the last 4 characters, and none
  for a secret shorter than 16); **Change** reopens the form, where a blank secret keeps the saved one.
  - Alternative: set `WI_REAL_GATEWAY_URL`, `WI_REAL_PF_URL`, `WI_REAL_CLIENT_ID` and
    `WI_REAL_CLIENT_SECRET` in a `.env` beside the compose file (gitignored, kept out of the image by
    `.dockerignore`; see `.env.example`). A complete saved connection wins over `.env`. The three
    non-secret values alone in `.env` prefill the form.
  - Demo flag, off by default: `WI_SHOW_REAL_TOKEN=1` in the `.env` makes the server also return the minted token, and step 1 shows it
    (with Copy and a Decode toggle for header / payload / signature). Without it the token never reaches the browser. Use it only on a
    presenter's own machine; the token is short-lived but is a live credential until it expires.
  - Not connected → the Mode menu's Real option is disabled and `POST /api/mode {"source":"real"}`
    answers 409 naming what is missing.
  - The server mints the token (`client_credentials`, `audience=<agent app URL>`), calls
    `<gateway>/<app>/mcp` with it, and calls the passthrough app's `whoami`. The client secret
    and the real token never reach the browser: the page gets an opaque handle and the decoded claims.
  - Step 3 compares the claims the backend reports with the ones minted, so "token unchanged"
    is checked, not assumed.
  - Every upstream failure (PingFederate refusing, gateway unreachable, 5xx) is a named error on
    the page, never a blank result.

### Proving it went through Privilege (Real mode)
The **What Privilege did** section shows, for every gateway call, the exact request sent, the exact response
returned (status, headers, body) and the decisions the gateway made, in order. In Mock these are the mock
gateway's own checks. In Real the gateway returns a status and a body but no per-check breakdown, so its
decisions are marked *inferred from the outcome* (and Pass Agent Token *observed*, by comparing claims); the
gateway log is the authoritative record. The banner names the real hosts; step 2 shows the gateway's HTTP status and request id. The proof is
on the Privilege side: the gateway log line `workload token accepted for key <key> issuer=<iss>
subject=<sub>` with no `policy denied` beside it, plus the console objects the page's "Show it in
Privilege" section lists (the Non-Human Identity, the agent in the Agent Registry, the Pass Agent
Token MCP app). Mock mode leaves nothing in Privilege by design.

## What each layer logged for this run (rule 27)
Under **Run the flow** the page shows one run in six layers: person, agent, Authorize, Privilege, agent gateway and resource
server. The panel is the shared `web/src/run-observability/` (vendored, pinned). The record is built by the server
(`server/src/runLog.js`) from the four gateway steps of the run; the direct comparison and Break it are not recorded.

- **Where the logs live.** This lab reads no logs. Its own record comes from the replies it got (Real) or the mock's own
  computation (Mock). Each gateway decision also writes one stdout line of the lab's own, with the same time as its row.
  The products' logs: PingFederate writes to container stdout (only `server.log` and `init.log` reach stdout; `audit.log`
  is not shipped); the Privilege agent gateway writes `cyonproxy.log` to a volume (local) or the SIEM index
  `ping-siem-events-v2` (hosted). Where they stream: the shared collector to `ping-logs-*` and the Privilege SIEM export.
- **Mock rows are `simulated`** (the mock computed them). **Real rows are `response`** (the reply PingFederate or the
  gateway gave the lab). Nothing is shown as read from a log.
- **Not logged, and why.** Person: this lab signs no person in (the agent authenticates as itself). Authorize: this lab
  does not call PingOne Authorize. Privilege: the gateway answers one reply per call and the Privilege policy log is not
  read, so the gateway's answer is shown under **Agent gateway** and Privilege stays not logged. Resource server (Real):
  the MCP backend's own log is not read; its answer comes back through the gateway call.
- **Decisions.** Only a gateway's allow or refusal is a decision. Issuance is info. A call that got no reply (no
  connection or a timeout) has no row; its stdout line says `result=no-reply`.
- **Time = when the lab recorded it** (the same time as the row and the stdout line), not a product's own time.

## The real-world reference
Verified live 2026-11-13 against SE PingFederate + Privilege (see AI-DEMO2
`privilege/GATEWAY-WORKLOAD-IDENTITY-SETUP.md`, merged PR #3583): PF-issued token
accepted by the gateway as a workload identity, backend received it unchanged,
wrong-audience and garbage tokens refused.

## Test
```bash
npm test          # node --test, 37 tests (Real mode runs against local stand-ins for PingFederate and the gateway)
cd web && npx vitest run   # 17 tests
npm run doctor    # presenter checks
npm run reset     # clear the run log
```

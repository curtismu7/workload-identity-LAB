# Handoff — Dual path (none-Privilege vs Privilege), 2026-11-15

## What was built
The lab now demonstrates BOTH paths side by side:

| | Privilege gateway path | Direct path (new) |
|---|---|---|
| Token | same mock IdP JWT | same mock IdP JWT |
| Endpoint | `POST /api/gateway/federated-agent/mcp` | `POST /api/direct/:app/mcp` |
| Signature | verified vs JWKS | verified (direct backends do check signatures) |
| Audience binding | bound to the door | any `aud` |
| Required claims | `act.sub` + `client_id` pinned | none |
| Grant | 3 tools | all 5 (incl. GrantAdminTool, DeleteAllTool) |
| Pass Agent Token | forwarded + verified | backend verifies only |
| Audit | per-call gateway log | backend log only |

Teaching moment: ungoverned ≠ unsigned. The direct door still rejects a tampered
signature (401, signature stage) — what it does NOT do is manage: no grant, no
claims pinning, no audit trail, no pass-through semantics.

## Where things live
- `server/src/directDoor.js` — the direct door (verifyJwt signature+expiry, DIRECT_ONLY_TOOLS)
- `server/src/app.js` — `POST /api/direct/:app/mcp` (mock-only; Real mode answers 409 honestly)
- `web/src/App.jsx` — Path toggle (`path-privilege` / `path-direct`), per-lane results
  (`direct-log`, `direct-tool-list`, `direct-whoami-claims`), comparison card, Break-it buttons
  (`break-tampered` / `break-escalate`)
- `web/src/components/JwtBox.jsx` — the raw JWT: full-size box + Copy button
- `test/dual-path.test.js` — 6 server tests for the direct door
- `web/src/__tests__/App.test.jsx` — 4 new web tests + the trace-test fix

## State
- Branch `jwt-pane-copy` merged to main as PR #6. CI green (forbidden-strings + test).
- 43 server tests / 22 web tests / web build — all green.
- Independent reviewer verdict: no blocking issues; fix pass applied (375px overflow,
  segmented control on theme tokens).
- Governed door untouched (`git diff` on mockGateway.js empty across the commit).

## Open items for the next session
1. **muse-LAB stash**: `stash@{0}` in the lab repo holds another writer's WIP
   (trace refactor: GatewayTrace.jsx, trace.js, trace.test.js + modifications to
   app.js/mockGateway/realGateway). Do NOT drop it. It was stashed because it
   conflicted with a checkout; their PR #2 work is merged, so the stash may need
   a manual reconcile if they return.
2. **mcp-surface-LAB**: the credentials pass-through test fails at
   `App.test.jsx:130` (unchanged=false) — server logic makes false impossible
   (forward returns the same string; digest compare deterministic), so it's a
   test-side timing/stale-render race. Analysis on closed PR #6. Not a JsonPane
   blocker.
3. **Rule 24 sweep leftovers**: privilege-owasp-lab-LAB (parallel agent's PR was
   open; re-check), the 5 one-writer labs (id-jag, mcp-tools, hostile-mcp,
   agent-gateway-inspector, cimd), mcp-surface (needs the investigation first).
4. **FORBIDDEN_STRINGS secret**: a2a-lab-LAB's history contains
   `PingOneAuthorizeClient` (baseline commit a70e87a, a code-shape comment) —
   2 history hits remain after my message fix. Owner decision: history rewrite
   or drop the string from the secret.
5. **Two JsonPane variants** exist in the family (my 183-line self-contained vs
   the parallel agent's 251-line appfire-style with evidence/lanes + marks).
   Worth unifying in a shared-service PR.

## How to run
```bash
cd ~/Development/workload-identity-LAB
docker compose up --build -d     # http://127.0.0.1:7816
# dev: npm install, cd web && npm run build, PORT=7816 node server/src/index.js
npm test                          # 43 server tests
npx vitest run --root web         # 22 web tests
npm run doctor
```

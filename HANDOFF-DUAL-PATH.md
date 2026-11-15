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

## Open items: status (updated 2026-11-15, evening)
All five items from this handoff are closed.

1. **Stash: DONE, nothing to restore.** `stash@{0}` is mostly an older tree from before PR #2: it would delete
   trace.js, GatewayTrace.jsx, the Real tests and JsonPane. Its only new content is a TopMenu change, which
   AI-DEMO-Standalone #234 (merged) made canonical, so the lab picks it up with a normal top-menu re-pin. The
   stash is kept, and also saved as the local branch `stash-wip-trace-refactor` in `~/Development/workload-identity-LAB`.
2. **mcp-surface-LAB test: DONE, it was never a race.** Main passed the pass-through test 20/20. The closed PR #6
   failed it 20/20: its `Bits.Json` wrapped the JWT string into `{ raw }`, so the `mock-token` text no longer
   started with `eyJ`. The canonical JsonPane shows a bare JWT as text, so the test passes unchanged in
   mcp-surface #8.
3. **Rule 24 leftovers: DONE.** Merged: privilege-owasp #1, idjag-runner #6, cimd #14 + #15, hostile-mcp
   #9 + #12, mcp-surface #8, mcp-tools #25, id-jag-standalone #23 + #25, and agent-gateway-inspector #8, #9, #10
   and #13.
   - agent-gateway-inspector #9 fixed the server suite, which had hung CI for 6 h: `createHealth()` was called
     without the arguments it now needs, and `createApp` read `env` before declaring it.
   - Owner decisions:
     - hostile-mcp opens in the JSON view and keeps the exact `<IMPORTANT>` mark.
     - agent-gateway-inspector keeps its marks and chips, with a JSON pane under each.
     - cimd and id-jag show their single values as JsonPanes.
     - mcp-tools keeps the confirm-dialog arguments as exact text.
   - The J1 checker no longer reads regex literals as JSX (AI-DEMO-Standalone #260).
   - Submodule pins: AI-DEMO-Standalone #240, #248 and #265.
4. **FORBIDDEN_STRINGS: DONE before this session.** The a2a-lab-LAB secret was updated at 13:06Z, and main CI
   reports 0 hits.
5. **Two JsonPane variants: DONE.** a2a-lab #10 and workload-identity #7 replaced the 183-line Formatted | Raw
   variant with the canonical 251-line Form | JSON one (AI-DEMO-Standalone `shared/json`, #224). The family now
   has one JsonPane.

### Also done this session (workload-identity-LAB)
- **#7:** canonical JsonPane. GatewayTrace request and response are one uncapped transcript each, with the JSON
  body in its own pane, and two tables are wrapped so the page has no sideways scroll at 375px.
- **#11:** the Real form shows a saved client secret masked, as `•••••• saved (ends …abcd)`. The server sends
  only the last 4 characters, and none for a secret shorter than 16. **Change** reopens the form, and a blank
  secret keeps the saved one.
- **Deployed:** the live container (`workload-identity-LAB-wt-deploy`, detached at origin/main 3a6e474) is
  rebuilt from main.

### Main rewritten (owner-approved)
GitHub's squash merge added a co-author trailer naming the owner's own short noreply address to some commits,
because they were authored with that address. That breaks rule 8. Mains were rewritten with
force-with-lease, keeping the same trees:

| Repo | Old | New |
|---|---|---|
| agent-gateway-inspector | 1337426, d926199 | 91d6a06, 4051117 |
| id-jag-standalone | ab33b4b | a1df1bf |
| AI-DEMO-Standalone | 3a45884, a23c877 | 38648f4, 1f9508d |

Prevention: commit as `cmuir@pingidentity.com` or `49688644+curtismu7@users.noreply.github.com`, and always pass
`--body` to `gh pr merge --squash`.

### Still open (not this lab's work)
- **Real mode has never run against the live tenant.** The owner generates a new secret for
  `pf-route-c-test` in the cmuir-pf admin console (Applications → OAuth → Clients → Change Secret), then pastes
  it once via **Run through Privilege (Real)**.
- **AI-DEMO-Standalone PR #244** (`pin/gateway-claims-users`, another session) is still based on the
  pre-rewrite commits and needs a rebase onto main. The shared `~/Development/AI-DEMO-Standalone` checkout and
  its worktrees still have the old commits in local `main`: their owner should `git fetch` and reset to
  `origin/main`.
- **Optional checker follow-up:** J1 still has the same gap for a `<tag>` inside a string literal. It is a
  false positive only for an unclosed tag followed by a pretty `JSON.stringify`.
- **agent-gateway-inspector:** the restored marked block keeps its 256px cap. Removing it is one line in
  `web/src/app.css`.
- **id-jag-standalone:** `InspectPage.jsx:86` still shows its Actual column as `String(c.actual)`. The owner
  decides whether it should match.

## How to run
```bash
cd ~/Development/workload-identity-LAB
docker compose up --build -d     # http://127.0.0.1:7816
# dev: npm install, cd web && npm run build, PORT=7816 node server/src/index.js
npm test                          # 44 server tests
npx vitest run --root web         # 26 web tests
npm run doctor
```

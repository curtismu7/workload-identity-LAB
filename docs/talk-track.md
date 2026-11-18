# Talk track — Workload Identity Lab

Three minutes, mock mode. Say first: "this is a mock gateway in-process — no tenant, no outbound calls; real mode drives our SE PingFederate and Privilege gateway when it is configured."

1. **No secret at all.** "The agent authenticates with a JWT from its own identity platform — PingFederate, Kubernetes, GitHub Actions, any OIDC issuer. It holds no gateway secret: the workload identity IS the credential."
2. **Mint.** "Press Mint: the IdP issues the agent's JWT and you see every claim decoded on screen — issuer, audience, subject, the agent key it binds to."
3. **Gateway check.** "The gateway fetches the issuer's registered JWKS, verifies the signature, matches issuer/audience and the required claims, then enforces the agent key's grant. The log line names all three."
4. **Pass Agent Token.** "The backend's whoami reports the token unchanged — Pass Agent Token: the gateway forwards, it does not re-mint or rewrite."
5. **Control.** "Garbage bearer: 401. Flip one signature character: refused at the signature stage. Wrong audience: refused at the audience stage — the classic token-served-by-the-default-token-manager mix-up."
6. **Why it matters.** "No static secret to leak or rotate on the agent host; the gateway trusts the issuer's keys, not a shared password. Revoking the agent key kills access without touching the IdP."

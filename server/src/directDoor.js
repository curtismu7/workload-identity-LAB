// The DIRECT door: what happens when the agent calls the MCP backend itself with the same
// IdP token and no gateway in between. A real resource server still verifies the token it is
// handed — so this door checks the JWT signature and lifetime — and stops there: no audience
// binding to a gateway door, no required-claims pinning, no grant/tool filtering, no
// Pass Agent Token semantics. Tools the gateway's grant would never expose are reachable here.
import { jwks, verifyJwt } from './keys.js';

const GRANT_TOOLS = ['ListIndexTool', 'SearchIndexTool', 'CountTool'];
// The gateway grant hides these; the direct backend serves whatever it has.
export const DIRECT_ONLY_TOOLS = ['GrantAdminTool', 'DeleteAllTool'];
const ALL_TOOLS = [...GRANT_TOOLS, ...DIRECT_ONLY_TOOLS];

export function directCall(token, body) {
  const v = verifyJwt(token, jwks());
  if (!v.ok) {
    return {
      http: 401,
      body: { error: 'unauthorized', error_description: `token rejected: ${v.reason}`, stage: 'signature', detail: v.reason },
      log: `direct backend rejected token: ${v.reason}`,
      claims: null,
    };
  }
  const c = v.payload;
  if ((c.exp || 0) * 1000 < Date.now()) {
    return {
      http: 401,
      body: { error: 'unauthorized', error_description: 'token expired', stage: 'lifetime', detail: 'token expired' },
      log: 'direct backend rejected token: expired',
      claims: null,
    };
  }
  const method = body?.method;
  if (method === 'tools/list') {
    return {
      http: 200,
      body: { jsonrpc: '2.0', id: body.id, result: { tools: ALL_TOOLS.map(name => ({ name, description: `Mock tool ${name}` })) } },
      log: `direct backend accepted the token (signature verified) and listed all ${ALL_TOOLS.length} tools — no grant to check`,
      claims: c,
    };
  }
  if (method === 'tools/call' && body?.params?.name === 'whoami') {
    return {
      http: 200,
      body: { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify({ receivedClaims: c, note: 'the backend verified the token itself and reports its claims raw — no gateway enrichment' }, null, 2) }] } },
      log: 'direct backend answered whoami from the token claims as presented',
      claims: c,
    };
  }
  if (method === 'tools/call') {
    // No grant enforcement: any tool the backend has is callable with a validly signed token.
    return {
      http: 200,
      body: { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: `tool ${body.params.name} executed (the direct backend has no grant to check)` }] } },
      log: `direct backend executed tool ${body.params.name} — no grant to check`,
      claims: c,
    };
  }
  return {
    http: 400,
    body: { jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32601, message: `method ${method} not supported` } },
    log: `unsupported method ${method}`,
    claims: c,
  };
}

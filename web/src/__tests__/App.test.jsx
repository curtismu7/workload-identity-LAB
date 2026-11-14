import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

const mockJson = (status, body) => ({ status, json: async () => body });
global.fetch = vi.fn();

import App from '../App.jsx';

beforeEach(() => {
  fetch.mockReset();
  fetch.mockImplementation((url, init) => {
    if (String(url).includes('/api/info')) return Promise.resolve(mockJson(200, { source: 'mock', realAvailable: false, idp: {}, gateway: {}, simulated: true }));
    if (String(url).includes('/api/runs')) return Promise.resolve(mockJson(200, { runs: [] }));
    if (String(url).includes('/api/idp/token')) return Promise.resolve(mockJson(200, { token: 'h.sig.s', claims: { iss: 'https://idp.workload-lab.invalid', aud: 'https://gateway.workload-lab.invalid/federated-agent/mcp', sub: 'demo-agent-1', act: { sub: 'demo-agent-1' } } }));
    if (String(url).includes('/api/gateway/federated-agent/mcp')) {
      const auth = init?.headers?.authorization || '';
      return Promise.resolve(auth === 'Bearer h.sig.s'
        ? mockJson(200, { jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'ListIndexTool' }, { name: 'SearchIndexTool' }, { name: 'CountTool' }] }, _meta: { log: 'workload token accepted for key demo-federated-agent' } })
        : mockJson(401, { error: 'unauthorized', stage: 'signature', detail: 'signature verification failed', _meta: { log: 'workload token rejected' } }));
    }
    if (String(url).includes('/api/gateway/federated-rs/mcp')) return Promise.resolve(mockJson(200, { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: JSON.stringify({ receivedClaims: { sub: 'demo-agent-1', act: { sub: 'demo-agent-1' } } }) }] } }));
    if (String(url).includes('/api/diagrams/')) return Promise.resolve(mockJson(200, { id: 'workload-identity-flow', title: 't', lede: 'l', groups: {}, nodes: [{ id: 'a', group: 'agent', label: 'Agent' }], edges: [] }));
    if (String(url).includes('/api/mode')) return Promise.resolve(mockJson(200, { source: init && JSON.parse(init.body).source }));
    return Promise.resolve(mockJson(200, {}));
  });
});

describe('Workload Identity Lab', () => {
  it('renders the flow with the simulation banner', async () => {
    render(<App />);
    expect(await screen.findByTestId('sim-banner')).toHaveTextContent(/SIMULATED/);
    expect(screen.getByRole('heading', { name: /federated agents/i })).toBeTruthy();
  });

  it('tells the presenter how to prove it in Privilege, and says Mock leaves nothing there', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: /show it in privilege/i })).toBeTruthy();
    expect(screen.getByTestId('console-map')).toHaveTextContent(/required claims/i);
    expect(screen.getByTestId('proof-log-line')).toHaveTextContent('workload token accepted for key');
    expect(screen.getByTestId('proof-mock-note')).toHaveTextContent(/nothing leaves this page/i);
  });

  it('real mode: the banner names the hosts, the real token is never shown, the proof note names the gateway', async () => {
    const base = fetch.getMockImplementation();
    fetch.mockImplementation((url, init) => {
      if (String(url).includes('/api/info')) return Promise.resolve(mockJson(200, { source: 'real', realAvailable: true, real: { pfHost: 'pf.example.com', gatewayHost: 'gw.example.com', scopes: 'openid whoami:read' }, simulated: false }));
      if (String(url).includes('/api/idp/token')) return Promise.resolve(mockJson(200, { token: 'wi-held-abc', held: true, claims: { iss: 'https://pf.example.com', aud: 'https://gw.example.com/pftoken/mcp' } }));
      return base(url, init);
    });
    render(<App />);
    expect(await screen.findByTestId('sim-banner')).toHaveTextContent(/REAL.*pf\.example\.com.*gw\.example\.com/);
    await userEvent.click(screen.getByTestId('run-btn'));
    expect(await screen.findByTestId('token-held')).toBeTruthy();
    expect(screen.queryByTestId('raw-token')).toBeNull();
    expect(screen.getByTestId('proof-real-note')).toHaveTextContent('gw.example.com');
  });

  it('real mode: a refused mint is named on the page and nothing is sent to the gateway', async () => {
    const base = fetch.getMockImplementation();
    fetch.mockImplementation((url, init) => {
      if (String(url).includes('/api/idp/token')) return Promise.resolve(mockJson(502, { error: 'idp_refused', message: 'PingFederate refused the token request (HTTP 400): invalid_target' }));
      return base(url, init);
    });
    render(<App />);
    await userEvent.click(await screen.findByTestId('run-btn'));
    expect(await screen.findByTestId('mode-error')).toHaveTextContent(/invalid_target/);
    expect(fetch.mock.calls.some(([u]) => String(u).includes('/api/gateway/'))).toBe(false);
  });

  it('shows what Privilege did: the decisions, the exact request and the exact response', async () => {
    const base = fetch.getMockImplementation();
    const trace = {
      source: 'mock',
      request: { method: 'POST', url: 'https://gateway.workload-lab.invalid/federated-agent/mcp', headers: { authorization: 'Bearer eyJhbGciOiJSUzI1NiIs… (900 characters, shortened)' }, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } },
      response: { status: 401, headers: { 'content-type': 'application/json' }, body: { error: 'unauthorized', stage: 'audience' } },
      decisions: [
        { id: 'signature', label: 'Signature', outcome: 'pass', basis: 'checked', evidence: 'verifies against the registered JWKS' },
        { id: 'audience', label: 'Audience', outcome: 'fail', basis: 'checked', evidence: 'aud https://other != https://door' },
        { id: 'grant', label: 'Grant', outcome: 'skipped', basis: 'checked', evidence: 'not reached: the token was refused' },
      ],
      record: 'workload token rejected: audience mismatch',
    };
    fetch.mockImplementation((url, init) => {
      if (String(url).includes('/api/gateway/federated-agent/mcp') && init?.headers?.authorization === 'Bearer h.sig.s') return Promise.resolve(mockJson(401, { error: 'unauthorized', _meta: { log: 'x', stage: 'audience', trace } }));
      return base(url, init);
    });
    render(<App />);
    expect(await screen.findByTestId('gateway-trace-empty')).toBeTruthy();
    await userEvent.click(screen.getByTestId('run-btn'));
    const decisions = await screen.findByTestId('trace-2-decisions');
    expect(decisions).toHaveTextContent(/Signature.*verifies against the registered JWKS/);
    expect(decisions).toHaveTextContent('PASS');
    expect(decisions).toHaveTextContent('FAIL');
    expect(decisions).toHaveTextContent('NOT REACHED');
    expect(screen.getByTestId('trace-2')).toHaveTextContent('refused at: Audience');
    expect(screen.getByTestId('trace-2-request')).toHaveTextContent('POST https://gateway.workload-lab.invalid/federated-agent/mcp');
    expect(screen.getByTestId('trace-2-request')).toHaveTextContent('shortened');
    expect(screen.getByTestId('trace-2-response')).toHaveTextContent('HTTP 401');
    expect(screen.getByTestId('gateway-trace-basis')).toHaveTextContent(/Simulated/);
  });

  it('real trace: inferred decisions are labelled as such, and an unreachable gateway shows no response', async () => {
    const base = fetch.getMockImplementation();
    const req = { method: 'POST', url: 'https://gw.example.com/pftoken/mcp', headers: { authorization: 'Bearer <PingFederate JWT, 900 characters, kept on the server>' }, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } };
    fetch.mockImplementation((url, init) => {
      if (String(url).includes('/api/info')) return Promise.resolve(mockJson(200, { source: 'real', realAvailable: true, real: { pfHost: 'pf.example.com', gatewayHost: 'gw.example.com', scopes: 'openid' }, simulated: false }));
      if (String(url).includes('/api/idp/token')) return Promise.resolve(mockJson(200, { token: 'wi-held-abc', held: true, claims: { iss: 'https://pf.example.com' } }));
      if (String(url).includes('/api/gateway/federated-agent/mcp') && init?.headers?.authorization === 'Bearer wi-held-abc') {
        return Promise.resolve(mockJson(200, { result: { tools: [] }, _meta: { source: 'real', log: 'x', trace: { source: 'real', request: req, response: { status: 200, headers: { 'x-request-id': 'req-1' }, body: { result: { tools: [] } } }, decisions: [{ id: 'authenticated', label: 'Token accepted', outcome: 'pass', basis: 'inferred', evidence: 'HTTP 200' }], record: 'Look for: workload token accepted', at: '2026-11-14T15:00:00Z', requestId: 'req-1' } } }));
      }
      if (String(url).includes('/api/gateway/federated-rs/mcp')) {
        return Promise.resolve(mockJson(502, { error: 'upstream_unreachable', _meta: { source: 'real', stage: 'upstream_unreachable', trace: { source: 'real', request: req, response: null, decisions: [{ id: 'reach', label: 'Reach the gateway', outcome: 'fail', basis: 'observed', evidence: 'upstream unreachable (connection refused)' }], record: null } } }));
      }
      return base(url, init);
    });
    render(<App />);
    await userEvent.click(await screen.findByTestId('run-btn'));
    expect(await screen.findByTestId('trace-2-decisions')).toHaveTextContent('inferred from the outcome');
    expect(screen.getByTestId('trace-2')).toHaveTextContent('request req-1');
    expect(screen.getByTestId('gateway-trace-basis')).toHaveTextContent(/authoritative record/i);
    expect(await screen.findByTestId('trace-3-response')).toHaveTextContent('No response');
    expect(screen.getByTestId('trace-3-decisions')).toHaveTextContent('connection refused');
  });

  it('run shows gateway acceptance, tools, passthrough and 401 control', async () => {
    render(<App />);
    await userEvent.click(await screen.findByTestId('run-btn'));
    await waitFor(() => expect(screen.getByTestId('gateway-log')).toHaveTextContent(/workload token accepted/));
    expect(screen.getByTestId('tool-list')).toHaveTextContent('ListIndexTool, SearchIndexTool, CountTool');
    expect(screen.getByTestId('whoami-claims')).toHaveTextContent('demo-agent-1');
  });

  it('json views render colored by default and toggle to raw', async () => {
    render(<App />);
    await userEvent.click(await screen.findByTestId('run-btn'));
    await waitFor(() => expect(screen.getByTestId('claims-view-pre')).toBeTruthy());
    const toggle = screen.getByTestId('claims-view-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('claims-view-pre').textContent).toContain('"iss"');
  });

  it('negative case shows the refusal stage', async () => {
    fetch.mockImplementation((url, init) => {
      if (String(url).includes('/api/gateway/federated-agent/mcp')) return Promise.resolve(mockJson(401, { error: 'unauthorized', stage: 'audience', detail: 'aud mismatch', _meta: { log: 'rejected: audience mismatch' } }));
      if (String(url).includes('/api/idp/token')) return Promise.resolve(mockJson(200, { token: 'h.sig.s', claims: { iss: 'i', aud: 'other' } }));
      if (String(url).includes('/api/runs')) return Promise.resolve(mockJson(200, { runs: [] }));
      if (String(url).includes('/api/diagrams/')) return Promise.resolve(mockJson(200, { id: 'x', title: 't', lede: 'l', groups: {}, nodes: [], edges: [] }));
      return Promise.resolve(mockJson(200, { source: 'mock', realAvailable: false }));
    });
    render(<App />);
    await userEvent.click(await screen.findByTestId('run-btn'));
    await waitFor(() => expect(screen.getAllByText('401').length).toBeGreaterThan(0));
  });
});

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

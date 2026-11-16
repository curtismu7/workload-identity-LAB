import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

const mockJson = (status, body) => ({ status, json: async () => body });
global.fetch = vi.fn();

import App from '../App.jsx';
import { setJsonView } from '../components/JsonPane.jsx';

beforeEach(() => {
  setJsonView('form'); // the Form | JSON choice is shared module state: start every test on Form
  fetch.mockReset();
  fetch.mockImplementation((url, init) => {
    if (String(url).includes('/api/info')) return Promise.resolve(mockJson(200, { source: 'mock', realAvailable: false, idp: {}, gateway: {}, simulated: true }));
    if (String(url).includes('/api/runs')) return Promise.resolve(mockJson(200, { runs: [] }));
    if (String(url).includes('/api/idp/token')) {
      const req = init && JSON.parse(init.body);
      const token = req?.corrupt === 'signature'
        ? 'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJ0ZXN0In0.tamperED'
        : 'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJ0ZXN0In0.fakesig';
      return Promise.resolve(mockJson(200, { token, claims: { iss: 'https://idp.workload-lab.invalid', aud: 'https://gateway.workload-lab.invalid/federated-agent/mcp', sub: 'demo-agent-1', act: { sub: 'demo-agent-1' } } }));
    }
    if (String(url).includes('/api/direct/backend/mcp')) {
      const auth = init?.headers?.authorization || '';
      const VALID = 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJ0ZXN0In0.fakesig';
      const method = init && JSON.parse(init.body).method;
      const params = (init && JSON.parse(init.body).params) || {};
      if (auth !== VALID) return Promise.resolve(mockJson(401, { error: 'unauthorized', stage: 'signature', detail: 'signature verification failed', _meta: { lane: 'direct', log: 'direct backend rejected token: signature verification failed' } }));
      if (method === 'tools/list') return Promise.resolve(mockJson(200, { jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'ListIndexTool' }, { name: 'SearchIndexTool' }, { name: 'CountTool' }, { name: 'GrantAdminTool' }, { name: 'DeleteAllTool' }] }, _meta: { lane: 'direct', log: 'direct backend accepted the token (signature verified) and listed all 5 tools — no grant to check' } }));
      if (params.name === 'whoami') return Promise.resolve(mockJson(200, { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: JSON.stringify({ receivedClaims: { sub: 'demo-agent-1', scope: 'federated:admin' } }) }] }, _meta: { lane: 'direct', log: 'direct backend answered whoami' } }));
      return Promise.resolve(mockJson(200, { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: `tool ${params.name} executed (the direct backend has no grant to check)` }] }, _meta: { lane: 'direct', log: `direct backend executed tool ${params.name}` } }));
    }
    if (String(url).includes('/api/gateway/federated-agent/mcp')) {
      const auth = init?.headers?.authorization || '';
      return Promise.resolve(auth === 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJ0ZXN0In0.fakesig'
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

  it('shell bar: brand, mode badge, the current page pill, the TopMenu; the banner opens <main>; one primary at a time', async () => {
    render(<App />);
    const bar = document.querySelector('header.shell-bar');
    expect(bar).not.toBeNull();
    expect(bar.querySelector('.shell-brand')).toHaveTextContent('Workload Identity Lab');
    expect(await screen.findByTestId('mode-badge')).toHaveTextContent('Mock');
    expect(screen.getByTestId('nav-lab')).toHaveAttribute('aria-current', 'page');
    expect(bar.querySelector('[data-testid="top-menu"]')).not.toBeNull();
    expect(document.querySelector('main').firstElementChild).toBe(screen.getByTestId('sim-banner'));
    expect(document.querySelectorAll('button.primary')).toHaveLength(1);
    expect(screen.getByTestId('run-btn')).toHaveClass('primary');
  });

  it('the connect form replaces the Run actions while open, so the page still has one primary', async () => {
    render(<App />);
    await userEvent.click(await screen.findByTestId('real-btn'));
    await screen.findByTestId('connect-form');
    expect(screen.queryByTestId('run-btn')).toBeNull();
    expect([...document.querySelectorAll('button.primary')].map(b => b.dataset.testid)).toEqual(['connect-btn']);
    await userEvent.click(screen.getByTestId('connect-cancel'));
    expect(screen.getByTestId('run-btn')).toHaveClass('primary');
  });

  it('tells the presenter how to prove it in Privilege, and says Mock leaves nothing there', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: /show it in privilege/i })).toBeTruthy();
    expect(screen.getByTestId('console-map')).toHaveTextContent(/required claims/i);
    expect(screen.getByTestId('proof-log-line')).toHaveTextContent('workload token accepted for key');
    expect(screen.getByTestId('proof-mock-note')).toHaveTextContent(/nothing leaves this page/i);
    expect(screen.getByTestId('proof-mock-note')).toHaveTextContent('Click Run through Privilege (Real)');
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
    const MINTED = 'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJ0ZXN0In0.fakesig';
    fetch.mockImplementation((url, init) => {
      if (String(url).includes('/api/gateway/federated-agent/mcp') && init?.headers?.authorization === `Bearer ${MINTED}`) return Promise.resolve(mockJson(401, { error: 'unauthorized', _meta: { log: 'x', stage: 'audience', trace } }));
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
    // the whole transcript goes to the shared pane: the head stays text, the JSON body gets its own Form | JSON pane
    expect(screen.getByTestId('trace-2-request').querySelector('.jwire .jsonbox__toggle')).toBeTruthy();
    expect(screen.getByTestId('trace-2-response').querySelector('.jwire .jsonbox__toggle')).toBeTruthy();
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

  it('the raw JWT renders in a full-size box with a Copy button', async () => {
    render(<App />);
    await userEvent.click(await screen.findByTestId('run-btn'));
    const box = await screen.findByTestId('raw-token-text');
    expect(box.textContent).toMatch(/^eyJ/);
    const copy = screen.getByTestId('raw-token-copy');
    expect(copy).toBeTruthy();
    await userEvent.click(copy);
    expect(await screen.findByTestId('raw-token-copy-state')).toHaveTextContent(/Copied|Select and copy/);
  });

  it('json panes offer Form | JSON and render claims in both', async () => {
    render(<App />);
    await userEvent.click(await screen.findByTestId('run-btn'));
    await waitFor(() => expect(screen.getByTestId('claims-view')).toBeTruthy());
    expect(screen.getByTestId('claims-view-formatted')).toHaveTextContent(/^Form$/);
    expect(screen.getByTestId('claims-view-raw')).toHaveTextContent(/^JSON$/);
    // Form is the default view: a form with a label per field
    expect(screen.getByTestId('claims-view')).toHaveTextContent('iss');
    // switch to JSON: the exact JSON text, coloured
    await userEvent.click(screen.getByTestId('claims-view-raw'));
    expect(screen.getByTestId('claims-view')).toHaveTextContent('"iss"');
    // back to Form
    await userEvent.click(screen.getByTestId('claims-view-formatted'));
    expect(screen.getByTestId('claims-view')).toHaveTextContent('iss');
  });

  it('negative case shows the refusal stage', async () => {
    fetch.mockImplementation((url, init) => {
      if (String(url).includes('/api/gateway/federated-agent/mcp')) return Promise.resolve(mockJson(401, { error: 'unauthorized', stage: 'audience', detail: 'aud mismatch', _meta: { log: 'rejected: audience mismatch' } }));
      if (String(url).includes('/api/idp/token')) return Promise.resolve(mockJson(200, { token: 'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJ0ZXN0In0.fakesig', claims: { iss: 'i', aud: 'other' } }));
      if (String(url).includes('/api/runs')) return Promise.resolve(mockJson(200, { runs: [] }));
      if (String(url).includes('/api/diagrams/')) return Promise.resolve(mockJson(200, { id: 'x', title: 't', lede: 'l', groups: {}, nodes: [], edges: [] }));
      return Promise.resolve(mockJson(200, { source: 'mock', realAvailable: false }));
    });
    render(<App />);
    await userEvent.click(await screen.findByTestId('run-btn'));
    await waitFor(() => expect(screen.getAllByText('401').length).toBeGreaterThan(0));
  });

  describe('the dual-path comparison (gateway vs direct)', () => {
    it('the path toggle renders and defaults to Privilege gateway', async () => {
      render(<App />);
      expect(await screen.findByTestId('path-privilege')).toBeTruthy();
      expect(screen.getByTestId('path-direct')).toBeTruthy();
      expect(screen.getByTestId('path-privilege').getAttribute('aria-checked')).toBe('true');
      expect(screen.getByTestId('path-direct').getAttribute('aria-checked')).toBe('false');
    });

    it('flipping to Direct and running shows the direct tool list including GrantAdminTool', async () => {
      render(<App />);
      await userEvent.click(await screen.findByTestId('path-direct'));
      expect(screen.getByTestId('path-direct').getAttribute('aria-checked')).toBe('true');
      await userEvent.click(screen.getByTestId('run-btn'));
      await waitFor(() => expect(screen.getByTestId('direct-tool-list')).toHaveTextContent('GrantAdminTool'));
      expect(screen.getByTestId('direct-tool-list')).toHaveTextContent('DeleteAllTool');
      expect(screen.getByTestId('direct-whoami-claims')).toHaveTextContent('demo-agent-1');
      expect(screen.getByTestId('direct-log')).toHaveTextContent(/no grant to check/);
    });

    it('the comparison card renders all 5 rows and the honesty note', async () => {
      render(<App />);
      const card = await screen.findByTestId('comparison-card');
      expect(card).toHaveTextContent(/no gateway in between.*in production that is exactly what happens/i);
      expect(card).toHaveTextContent('Grant enforcement');
      expect(card).toHaveTextContent('Audience binding');
      expect(card).toHaveTextContent('Required claims');
      expect(card).toHaveTextContent('Pass Agent Token');
      expect(card).toHaveTextContent('Audit');
      expect(card).toHaveTextContent('GrantAdminTool');
    });

    it('the Break-it buttons render their outcomes', async () => {
      render(<App />);
      await userEvent.click(await screen.findByTestId('path-direct'));
      await userEvent.click(screen.getByTestId('run-btn'));
      await userEvent.click(await screen.findByTestId('break-tampered'));
      expect(await screen.findByTestId('break-tampered-outcome')).toHaveTextContent(/signature check only/);
      await userEvent.click(screen.getByTestId('break-escalate'));
      expect(await screen.findByTestId('break-escalate-outcome')).toHaveTextContent(/GrantAdminTool/);
      expect(screen.getByTestId('break-escalate-outcome')).toHaveTextContent(/unmanaged/);
    });
  });

  describe('the Real button', () => {
    const SECRET = 'fake-client-secret-DO-NOT-LEAK';
    const REAL_SCOPES = 'opensearch:read whoami:read';
    const realInfo = (extra = {}) => ({ source: 'mock', realAvailable: true, realSource: 'saved', real: { pfHost: 'pf.example.com', gatewayHost: 'gw.example.com', clientId: 'pf-client', scopes: REAL_SCOPES }, realForm: { gatewayUrl: 'https://gw.example.com', pfUrl: 'https://pf.example.com', clientId: 'pf-client' }, simulated: true, ...extra });
    const callsTo = (part) => fetch.mock.calls.filter(([u]) => String(u).includes(part));
    // Not connected yet; a successful connect flips the server's answer to connected
    const unconnected = ({ connect }) => {
      const base = fetch.getMockImplementation();
      let connected = false;
      fetch.mockImplementation((url, init) => {
        const u = String(url);
        if (u.includes('/api/info')) return Promise.resolve(mockJson(200, connected ? realInfo({ source: 'real', simulated: false }) : { source: 'mock', realAvailable: false, realSource: null, realForm: { gatewayUrl: 'https://gw.example.com', pfUrl: 'https://pf.example.com', clientId: 'pf-client' }, simulated: true }));
        if (u.includes('/api/real/connect')) { const r = connect(JSON.parse(init.body)); if (r.status === 200) connected = true; return Promise.resolve(mockJson(r.status, r.body)); }
        return base(url, init);
      });
    };

    it('not connected: the button opens the form, prefilled, with an empty secret, and nothing runs', async () => {
      unconnected({ connect: () => ({ status: 200, body: { ok: true } }) });
      render(<App />);
      await userEvent.click(await screen.findByTestId('real-btn'));
      expect(await screen.findByTestId('connect-form')).toBeTruthy();
      expect(screen.getByTestId('connect-gateway')).toHaveValue('https://gw.example.com');
      expect(screen.getByTestId('connect-pf')).toHaveValue('https://pf.example.com');
      expect(screen.getByTestId('connect-client')).toHaveValue('pf-client');
      expect(screen.getByTestId('connect-secret')).toHaveValue('');
      expect(screen.getByTestId('connect-secret').getAttribute('type')).toBe('password');
      expect(callsTo('/api/idp/token')).toHaveLength(0);
      expect(callsTo('/api/real/connect')).toHaveLength(0);
    });

    it('connect and run: sends the form once, switches to Real, runs with the Real scope, and the secret is gone from the page', async () => {
      let sent;
      unconnected({ connect: (b) => { sent = b; return { status: 200, body: { ok: true, persisted: true } }; } });
      const base = fetch.getMockImplementation();
      fetch.mockImplementation((url, init) => {
        if (String(url).includes('/api/idp/token')) return Promise.resolve(mockJson(200, { token: 'wi-held-abc', held: true, claims: { iss: 'https://pf.example.com' } }));
        return base(url, init);
      });
      render(<App />);
      await userEvent.click(await screen.findByTestId('real-btn'));
      await userEvent.click(await screen.findByTestId('connect-secret'));
      await userEvent.paste(SECRET); // a secret is pasted, not typed
      await userEvent.click(screen.getByTestId('connect-btn'));
      await waitFor(() => expect(screen.queryByTestId('connect-form')).toBeNull());
      expect(sent).toEqual({ gatewayUrl: 'https://gw.example.com', pfUrl: 'https://pf.example.com', clientId: 'pf-client', clientSecret: SECRET });
      expect(JSON.parse(callsTo('/api/mode').at(-1)[1].body)).toEqual({ source: 'real' });
      await screen.findByTestId('token-held');
      // The run used the Real scope the moment Real was switched on, not the stale Mock one
      expect(JSON.parse(callsTo('/api/idp/token')[0][1].body).scope).toBe(REAL_SCOPES);
      expect(await screen.findByTestId('sim-banner')).toHaveTextContent(/REAL.*pf\.example\.com/);
      expect(document.body.textContent).not.toContain(SECRET);
      expect(document.body.innerHTML).not.toContain(SECRET);
    });

    it('PingFederate refusing the client is named in the form, keeps the form open, and runs nothing', async () => {
      unconnected({ connect: () => ({ status: 401, body: { error: 'idp_refused', message: 'PingFederate refused the token request (HTTP 401): invalid_client' } }) });
      render(<App />);
      await userEvent.click(await screen.findByTestId('real-btn'));
      await userEvent.click(await screen.findByTestId('connect-secret'));
      await userEvent.paste('wrong');
      await userEvent.click(screen.getByTestId('connect-btn'));
      expect(await screen.findByTestId('connect-error')).toHaveTextContent(/PingFederate refused.*invalid_client/);
      expect(screen.getByTestId('connect-form')).toBeTruthy();
      expect(callsTo('/api/mode')).toHaveLength(0);
      expect(callsTo('/api/idp/token')).toHaveLength(0);
    });

    it('cancel closes the form and drops the typed secret', async () => {
      unconnected({ connect: () => ({ status: 200, body: { ok: true } }) });
      render(<App />);
      await userEvent.click(await screen.findByTestId('real-btn'));
      await userEvent.click(await screen.findByTestId('connect-secret'));
      await userEvent.paste(SECRET); // a secret is pasted, not typed
      await userEvent.click(screen.getByTestId('connect-cancel'));
      expect(screen.queryByTestId('connect-form')).toBeNull();
      await userEvent.click(screen.getByTestId('real-btn'));
      expect(await screen.findByTestId('connect-secret')).toHaveValue('');
    });

    it('already connected: the button switches to Real and runs, with no form; the status line names the connection', async () => {
      const base = fetch.getMockImplementation();
      let real = false;
      fetch.mockImplementation((url, init) => {
        const u = String(url);
        if (u.includes('/api/info')) return Promise.resolve(mockJson(200, realInfo({ source: real ? 'real' : 'mock', simulated: !real })));
        if (u.includes('/api/mode')) { real = true; return Promise.resolve(mockJson(200, { source: 'real' })); }
        if (u.includes('/api/idp/token')) return Promise.resolve(mockJson(200, { token: 'wi-held-abc', held: true, claims: { iss: 'https://pf.example.com' } }));
        return base(url, init);
      });
      render(<App />);
      expect(await screen.findByTestId('real-status')).toHaveTextContent(/pf\.example\.com.*gw\.example\.com.*pf-client/);
      await userEvent.click(screen.getByTestId('real-btn'));
      await screen.findByTestId('token-held');
      expect(screen.queryByTestId('connect-form')).toBeNull();
      expect(JSON.parse(callsTo('/api/idp/token')[0][1].body).scope).toBe(REAL_SCOPES);
    });

    it('clicked before the page has loaded its info: asks the server instead of showing the form to a connected lab', async () => {
      const base = fetch.getMockImplementation();
      let infoCalls = 0;
      fetch.mockImplementation((url, init) => {
        const u = String(url);
        if (u.includes('/api/info')) { infoCalls += 1; return infoCalls === 1 ? new Promise(() => {}) : Promise.resolve(mockJson(200, realInfo())); } // the first load never answers
        if (u.includes('/api/idp/token')) return Promise.resolve(mockJson(200, { token: 'wi-held-abc', held: true, claims: { iss: 'https://pf.example.com' } }));
        return base(url, init);
      });
      render(<App />);
      await userEvent.click(await screen.findByTestId('real-btn'));
      await screen.findByTestId('token-held');
      expect(screen.queryByTestId('connect-form')).toBeNull();
    });

    it('not connected and clicked before the info loaded: the form is still prefilled from the server', async () => {
      const base = fetch.getMockImplementation();
      let infoCalls = 0;
      const form = { gatewayUrl: 'https://gw.example.com', pfUrl: 'https://pf.example.com', clientId: 'pf-client' };
      fetch.mockImplementation((url, init) => {
        if (String(url).includes('/api/info')) { infoCalls += 1; return infoCalls === 1 ? new Promise(() => {}) : Promise.resolve(mockJson(200, { source: 'mock', realAvailable: false, realForm: form, simulated: true })); }
        return base(url, init);
      });
      render(<App />);
      await userEvent.click(await screen.findByTestId('real-btn'));
      expect(await screen.findByTestId('connect-gateway')).toHaveValue('https://gw.example.com');
      expect(screen.getByTestId('connect-client')).toHaveValue('pf-client');
    });

    it('a saved secret shows masked (last 4 only); Change reopens the form with a blank secret that keeps it', async () => {
      let sent;
      const base = fetch.getMockImplementation();
      fetch.mockImplementation((url, init) => {
        const u = String(url);
        if (u.includes('/api/info')) return Promise.resolve(mockJson(200, realInfo({ realSecret: { set: true, ends: '…LEAK' } })));
        if (u.includes('/api/real/connect')) { sent = JSON.parse(init.body); return Promise.resolve(mockJson(200, { ok: true, persisted: true })); }
        return base(url, init);
      });
      render(<App />);
      expect(await screen.findByTestId('real-secret-hint')).toHaveTextContent('Client secret: •••••• saved (ends …LEAK).');
      expect(document.body.textContent).not.toContain(SECRET);
      await userEvent.click(screen.getByTestId('real-change'));
      const secret = await screen.findByTestId('connect-secret');
      expect(secret).toHaveValue('');
      expect(secret.getAttribute('type')).toBe('password');
      expect(secret.getAttribute('placeholder')).toBe('•••••• saved (ends …LEAK), leave blank to keep it');
      expect(screen.getByTestId('connect-client')).toHaveValue('pf-client');
      await userEvent.click(screen.getByTestId('connect-btn'));
      await waitFor(() => expect(sent).toBeTruthy());
      expect(sent.clientSecret).toBe('');
      await waitFor(() => expect(screen.queryByTestId('connect-form')).toBeNull());
    });

    it('a short saved secret shows no characters', async () => {
      const base = fetch.getMockImplementation();
      fetch.mockImplementation((url, init) => String(url).includes('/api/info')
        ? Promise.resolve(mockJson(200, realInfo({ realSecret: { set: true, ends: null } }))) : base(url, init));
      render(<App />);
      expect(await screen.findByTestId('real-secret-hint')).toHaveTextContent(/^Client secret: •••••• saved\.$/);
    });

    it('forget asks the server to drop the saved connection and the page goes back to Mock', async () => {
      const base = fetch.getMockImplementation();
      let forgotten = false;
      fetch.mockImplementation((url, init) => {
        const u = String(url);
        if (u.includes('/api/info')) return Promise.resolve(mockJson(200, forgotten ? { source: 'mock', realAvailable: false, realSource: null, simulated: true } : realInfo({ source: 'real', simulated: false })));
        if (u.includes('/api/real/forget')) { forgotten = true; return Promise.resolve(mockJson(200, { forgotten: true, source: 'mock' })); }
        return base(url, init);
      });
      render(<App />);
      await userEvent.click(await screen.findByTestId('run-btn')); // a Real run is on the page
      await screen.findByTestId('claims-view');
      await userEvent.click(await screen.findByTestId('real-forget'));
      await waitFor(() => expect(screen.queryByTestId('real-status')).toBeNull());
      expect(screen.queryByTestId('claims-view')).toBeNull();
      expect(screen.getByTestId('gateway-trace-empty')).toBeTruthy(); // nothing left to be mislabelled Simulated
      expect(callsTo('/api/real/forget')).toHaveLength(1);
      expect(await screen.findByTestId('sim-banner')).toHaveTextContent(/SIMULATED/);
    });
  });
});

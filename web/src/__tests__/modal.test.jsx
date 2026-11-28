// The Real-or-mock modal replaces the old simulation banner: MOCK or REAL with this lab's own line, held until /api/info answers, and back on a mode switch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import App, { modeLines } from '../App.jsx';

const mockJson = (status, body) => ({ status, json: async () => body });
const REAL_INFO = { source: 'real', realAvailable: true, real: { pfHost: 'pf.example.com', gatewayHost: 'gw.example.com', scopes: 'openid whoami:read' }, simulated: false };
const MOCK_INFO = { source: 'mock', realAvailable: false, simulated: true };
let info;
beforeEach(() => {
  info = MOCK_INFO;
  global.fetch = vi.fn((url, init) => {
    const u = String(url);
    if (u.includes('/api/info')) return Promise.resolve(mockJson(200, info));
    if (u.includes('/api/runs')) return Promise.resolve(mockJson(200, { runs: [] }));
    if (u.includes('/api/mode')) { info = JSON.parse(init.body).source === 'real' ? REAL_INFO : MOCK_INFO; return Promise.resolve(mockJson(200, { source: info.source })); }
    if (u.includes('/api/diagrams/')) return Promise.resolve(mockJson(200, { id: 'workload-identity-flow', title: 't', lede: 'l', groups: {}, nodes: [{ id: 'a', group: 'agent', label: 'Agent' }], edges: [] }));
    return Promise.resolve(mockJson(200, {}));
  });
});
afterEach(() => cleanup());

describe('Real-or-mock modal', () => {
  it('Mock: says MOCK with the old banner facts (in-process mocks, no real system called, tokens labelled) and Got it closes it', async () => {
    render(<App />);
    const modal = await screen.findByTestId('mode-modal');
    expect(modal).toHaveAttribute('data-mode', 'mock');
    expect(modal.textContent).toMatch(/^MOCK/);
    expect(modal).toHaveTextContent('The IdP, gateway and MCP backend on this page are in-process mocks; no real system is called.');
    expect(modal).toHaveTextContent('Mock-issued tokens are labelled.');
    fireEvent.click(screen.getByTestId('mode-modal-ok'));
    expect(screen.queryByTestId('mode-modal')).toBeNull();
  });

  it('Real on load: says REAL and names the real hosts and that the secret stays on the server', async () => {
    info = REAL_INFO;
    render(<App />);
    const modal = await screen.findByTestId('mode-modal');
    expect(modal).toHaveAttribute('data-mode', 'real');
    expect(modal.textContent).toMatch(/^REAL/);
    expect(modal).toHaveTextContent('The token is minted by pf.example.com and every call goes to the Privilege gateway at gw.example.com.');
    expect(modal).toHaveTextContent('The client secret stays on the server and is never sent to the browser.');
  });

  it('shows nothing until /api/info answers, then the right mode (a Real lab never flashes MOCK)', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const base = global.fetch.getMockImplementation();
    info = REAL_INFO;
    global.fetch.mockImplementation(async (url, init) => { if (String(url).includes('/api/info')) await gate; return base(url, init); });
    render(<App />);
    await screen.findByRole('heading', { name: /federated agents/i });
    expect(screen.queryByTestId('mode-modal')).toBeNull();
    release();
    expect((await screen.findByTestId('mode-modal')).getAttribute('data-mode')).toBe('real');
  });

  it('a dismissed MOCK stays closed for the session; switching to Real shows REAL', async () => {
    render(<App />);
    fireEvent.click(await screen.findByTestId('mode-modal-ok'));
    expect(screen.queryByTestId('mode-modal')).toBeNull();
    fireEvent.change(await screen.findByTestId('mode-select'), { target: { value: 'real' } });
    await waitFor(() => expect(screen.getByTestId('mode-modal')).toHaveAttribute('data-mode', 'real'));
    expect(screen.getByTestId('mode-modal')).toHaveTextContent(/pf\.example\.com.*gw\.example\.com/);
  });

  it('with no host in /api/info the REAL line still reads true (falls back to PingFederate and the configured host)', () => {
    expect(modeLines(null).real).toBe('The token is minted by PingFederate and every call goes to the Privilege gateway at the configured host. The client secret stays on the server and is never sent to the browser.');
  });

  it('the simulation banner is gone in both modes; no .sim-banner paragraph carries the simulation text', async () => {
    for (const i of [MOCK_INFO, REAL_INFO]) {
      info = i;
      render(<App />);
      await screen.findByTestId('mode-modal');
      expect(screen.queryByTestId('sim-banner')).toBeNull();
      expect(document.querySelector('main .sim-banner')).toBeNull();
      expect(document.querySelector('main').textContent).not.toMatch(/SIMULATED —|REAL — the token/);
      cleanup(); sessionStorage.clear();
    }
  });
});

// The header shows this lab's own Verified / In progress mark, read from the demo shelf's /api/shelf (through the lab-proxy that call reaches the
// shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has no demos, so there is no mark then.
// This lab renders no Shelf link, so the badge sits in the shared TopMenu's children slot.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
vi.mock('../components/Diagram.jsx', () => ({ default: () => null })); // the header test does not need the flow diagram (ReactFlow wants ResizeObserver)
import App from '../App.jsx';

const mark = (status, label, extra = {}) => ({ status, label, note: '', updatedAt: '2026-11-15', source: 'shipped', ...extra });
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const stubShelf = (payload) => vi.stubGlobal('fetch', vi.fn(async (url) => {
  if (String(url) === '/api/shelf') { if (payload === null) throw new Error('down'); return ok(payload); }
  if (String(url).includes('/api/info')) return ok({ source: 'mock', realAvailable: false, idp: {}, gateway: {}, simulated: true });
  if (String(url).includes('/api/runs')) return ok({ runs: [] });
  if (String(url).includes('/api/diagrams/')) return ok({ id: 'workload-identity-flow', title: 't', lede: 'l', groups: {}, nodes: [{ id: 'a', group: 'agent', label: 'Agent' }], edges: [] });
  return ok({});
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('verification mark in the header', () => {
  it('shows this lab\'s own mark, and no other lab\'s', async () => {
    stubShelf({ shelfUrl: 'http://shelf.example', demos: [{ id: 'other-lab', verification: mark('in-progress', 'In progress') }, { id: 'workload-identity-lab', verification: mark('verified', 'Verified', { note: 'Every negative case run on the mock' }) }] });
    render(<App />);
    const bar = within(await screen.findByTestId('top-menu'));
    expect(await bar.findByText('Verified')).toBeInTheDocument();
    expect(bar.queryByText('In progress')).toBeNull();
    expect(document.querySelectorAll('.verify')).toHaveLength(1);
    expect(bar.getByText('Verified').closest('.verify')).toHaveAttribute('title', expect.stringContaining('Every negative case run on the mock'));
  });

  it('shows nothing when the lab is opened on its own port (its /api/shelf has no demos), the shelf has no mark for it, or the shelf is down', async () => {
    for (const shelf of [{ shelfUrl: 'http://shelf.example' }, { shelfUrl: 'http://shelf.example', demos: [{ id: 'workload-identity-lab', verification: null }] }, null]) {
      stubShelf(shelf); // null = the shelf is unreachable
      const { unmount } = render(<App />);
      await screen.findByTestId('top-menu');
      await new Promise((r) => setTimeout(r, 30)); // let the shelf call settle
      expect(document.querySelector('.verify')).toBeNull();
      unmount();
    }
  });
});

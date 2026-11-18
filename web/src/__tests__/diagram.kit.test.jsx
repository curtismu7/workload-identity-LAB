// Diagram is wired to the diagram kit (web/src/diagram-kit): arrow labels above the boxes, and a box that expands to show its details.
// React Flow does not render edges in jsdom, so the arrow drawing itself is proved in a real browser; here: what the page hands the kit.
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Diagram from '../components/Diagram.jsx';

// React Flow fits the view on a short timer; let it finish before the page is torn down, or it fires into a closed window.
afterEach(async () => { await act(async () => { await new Promise((r) => setTimeout(r, 120)); }); cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const doc = {
  id: 'workload-identity-flow', title: 't', lede: 'A token goes to the gate.',
  groups: { agent: { label: 'Agent (no gateway secret)', color: 'grey' }, gateway: { label: 'Gateway', color: 'red' }, backend: { label: 'MCP backend', color: 'blue' } },
  nodes: [{ id: 'agent', group: 'agent', label: 'Agent' }, { id: 'gate', group: 'gateway', label: 'Gate' }, { id: 'back', group: 'backend', label: 'Backend' }],
  edges: [{ from: 'agent', to: 'gate', label: 'Bearer JWT (2)' }, { from: 'gate', to: 'back', label: 'token forwarded (3)' }, { from: 'back', to: 'gate', label: '' }],
};
const mount = async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(doc) })));
  render(<Diagram />);
  await screen.findByTestId('wi-node-agent');
};
const node = (id) => screen.getByTestId(`wi-node-${id}`);
const open = () => [...document.querySelectorAll('.dk-open')].map((b) => b.getAttribute('data-testid'));

describe('arrow labels', () => {
  it('are drawn once per labelled arrow, in the kit layer above the boxes; an arrow with no label gets none', async () => {
    await mount();
    for (const [i, text] of [[0, 'Bearer JWT (2)'], [1, 'token forwarded (3)']]) {
      const l = screen.getByTestId(`dk-label-e${i}`); expect(l).toHaveTextContent(text);
      expect(document.querySelector('.react-flow__viewport-portal').contains(l)).toBe(true);
    }
    expect(screen.queryByTestId('dk-label-e2')).toBeNull();
  });
  it('Simulate marks the walked arrow\'s label', async () => {
    await mount();
    expect(document.querySelectorAll('.dk-label--on').length).toBe(0);
    fireEvent.click(screen.getByTestId('simulate-btn'));
    expect(document.querySelectorAll('.dk-label--on').length).toBe(1);
    expect(screen.getByTestId('dk-label-e0').className).toContain('dk-label--on');
  });
});

describe('a box expands in place', () => {
  it('clicking a box shows its details inside it: group, reach and both lists of arrows', async () => {
    await mount();
    expect(open()).toEqual([]);
    fireEvent.click(node('gate'));
    expect(open()).toEqual(['wi-node-gate']);
    const p = screen.getByTestId('dk-passport-gate');
    expect(node('gate').contains(p)).toBe(true);
    expect(p).toHaveTextContent('Gateway');                                                       // the group's own label from the document
    expect(screen.getByTestId('dk-passport-reach')).toHaveTextContent('Upstream 2 · Downstream 1'); // agent and back reach the gate; the gate reaches back
    expect(screen.getByTestId('dk-passport-outgoing')).toHaveTextContent('Outgoing · 1'); expect(screen.getByTestId('dk-passport-outgoing')).toHaveTextContent('token forwarded (3)');
    expect(screen.getByTestId('dk-passport-incoming')).toHaveTextContent('Incoming · 2'); expect(screen.getByTestId('dk-passport-incoming')).toHaveTextContent('Bearer JWT (2)');
    expect(screen.queryByTestId('dk-passport-sources')).toBeNull(); // the document has no code pointers
  });
  it('clicking the open box again collapses it, another box moves the expansion, the empty canvas collapses it', async () => {
    await mount();
    fireEvent.click(node('gate')); expect(open()).toEqual(['wi-node-gate']);
    fireEvent.click(node('gate')); expect(open()).toEqual([]);
    fireEvent.click(node('gate')); fireEvent.click(node('back')); expect(open()).toEqual(['wi-node-back']);
    fireEvent.click(document.querySelector('.react-flow__pane')); expect(open()).toEqual([]);
  });
  it('an item opens the box at the other end, Close collapses, and the diagram\'s Reset collapses it', async () => {
    await mount();
    fireEvent.click(node('gate'));
    fireEvent.click(screen.getByTestId('dk-passport-outgoing').querySelector('button.dk-passport-go')); // by class: jsdom never measures nodes, so React Flow keeps them visibility:hidden
    expect(open()).toEqual(['wi-node-back']);
    fireEvent.click(screen.getByTestId('dk-passport-close')); expect(open()).toEqual([]);
    fireEvent.click(node('agent')); expect(open()).toEqual(['wi-node-agent']);
    fireEvent.click(screen.getByTestId('diagram-reset-btn')); expect(open()).toEqual([]);
  });
  it('the expanded box is raised above its neighbours', async () => {
    window.history.replaceState(null, '', '/?box=gate'); // opened from a link, so React Flow has not raised it by selecting it
    await mount();
    expect(Number(node('gate').closest('.react-flow__node').style.zIndex)).toBe(10);
    expect(Number(node('agent').closest('.react-flow__node').style.zIndex)).toBe(0);
  });
});

describe('a shared link', () => {
  it('?box=<id> opens the diagram with that box expanded; a box that is not in the diagram is ignored', async () => {
    window.history.replaceState(null, '', '/?box=back'); await mount(); expect(open()).toEqual(['wi-node-back']);
    cleanup(); window.history.replaceState(null, '', '/?box=ghost'); await mount(); expect(open()).toEqual([]);
  });
  it('Copy link puts the page\'s address with ?box=<id> on the clipboard, keeping the rest of the address', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    window.history.replaceState(null, '', '/?mode=real#diagram');
    await mount(); fireEvent.click(node('agent'));
    await act(async () => { fireEvent.click(screen.getByTestId('dk-passport-copy')); });
    const url = new URL(writeText.mock.calls[0][0]);
    expect(url.searchParams.get('box')).toBe('agent'); expect(url.searchParams.get('mode')).toBe('real'); expect(url.hash).toBe('#diagram');
  });
});

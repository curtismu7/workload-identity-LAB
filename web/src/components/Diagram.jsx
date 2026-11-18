import React, { useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, MarkerType, Position, applyNodeChanges } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowNoLabel, EdgeLabels, FitOpen, Passport, PassportActions } from '../diagram-kit/DiagramKit.jsx';
import { boxPassport, sidePoint } from '../diagram-kit/diagramKit.js';
import '../diagram-kit/diagram-kit.css';

// Renders a diagram-studio/1 document (loaded by name from /api/diagrams/:id).
// Boxes are movable, Reset restores positions, Simulate walks the edges in order
// with a speed control (rule 5). Arrow labels and the expanding boxes come from the
// shared diagram kit (./diagram-kit, vendored byte for byte): labels sit above the boxes and
// clear of each other; click a box and it expands in place with its group, reach and arrows.
const GROUP_COLORS = { red: '#b3232a', blue: '#1f5aa8', amber: '#b06d00', grey: '#5b6770', dark: '#22282e' };
const HANDLES = [['t', Position.Top], ['b', Position.Bottom], ['l', Position.Left], ['r', Position.Right]];
const layout = (i) => ({ x: 60 + (i % 2) * 260, y: 40 + i * 78 });
const initialNodes = (d) => d.nodes.map((n, i) => ({
  id: n.id, type: 'box', position: layout(i),
  data: { id: n.id, label: `${n.label}`, color: GROUP_COLORS[d.groups?.[n.group]?.color] || '#5b6770' },
}));

function Box({ data }) {
  return (
    <div className={`wi-node${data.passport ? ' dk-open' : ''}`} style={{ borderColor: data.color }} data-testid={`wi-node-${data.id}`}>
      {HANDLES.map(([k, pos]) => (
        <span key={k}>
          <Handle id={`s-${k}`} type="source" position={pos} className="wi-handle" />
          <Handle id={`t-${k}`} type="target" position={pos} className="wi-handle" />
        </span>
      ))}
      {data.label}
      {data.passport && <Passport p={data.passport} />}
    </div>
  );
}
const nodeTypes = { box: Box };
// The arrow draws the curve only; every label is drawn by EdgeLabels, above the boxes.
const edgeTypes = { arrow: ArrowNoLabel };

// Which side of each box an arrow leaves and enters, from where the two boxes are now.
function sides(a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? ['r', 'l'] : ['l', 'r']) : (dy > 0 ? ['b', 't'] : ['t', 'b']);
}

export default function Diagram({ diagramId = 'workload-identity-flow', theme = 'light' }) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');
  const [nodes, setNodes] = useState([]);
  const [active, setActive] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(800);
  const [open, setOpen] = useState(null); // the id of the expanded box, or null

  useEffect(() => {
    fetch(`/api/diagrams/${diagramId}`)
      .then(r => { if (!r.ok) throw new Error(`diagram ${r.status}`); return r.json(); })
      .then(d => {
        setDoc(d);
        setNodes(initialNodes(d));
        const box = new URLSearchParams(window.location.search).get('box'); // a shared link opens its box
        setOpen(box && d.nodes.some((n) => n.id === box) ? box : null);
      })
      .catch(e => setError(String(e.message)));
  }, [diagramId]);

  // The diagram as a graph (boxes, arrows, groups) for the details of an expanded box.
  const graph = useMemo(() => (doc ? {
    nodes: doc.nodes.map((n) => ({ id: n.id, label: `${n.label}`, group: n.group })),
    edges: (doc.edges || []).map((e) => ({ source: e.from, target: e.to, label: e.label || '' })),
    groups: doc.groups,
  } : null), [doc]);

  const { edges, labels } = useMemo(() => {
    const at = Object.fromEntries(nodes.map((n) => [n.id, n.position]));
    const edgeList = []; const labelList = [];
    (doc?.edges || []).forEach((e, i) => {
      if (!at[e.from] || !at[e.to]) return;
      const [a, b] = sides(at[e.from], at[e.to]);
      const on = playing && i <= active;
      const now = playing && i === active;
      edgeList.push({
        id: `e${i}`, source: e.from, target: e.to, sourceHandle: `s-${a}`, targetHandle: `t-${b}`, type: 'arrow',
        animated: on, markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: on ? '#b3232a' : '#9aa4ad', strokeWidth: now ? 2.5 : 1.5 },
      });
      labelList.push({ id: `e${i}`, text: e.label || '', source: e.from, target: e.to, sourceHandle: `s-${a}`, targetHandle: `t-${b}`, active: now, dim: false });
    });
    return { edges: edgeList, labels: labelList };
  }, [doc, nodes, playing, active]);

  const flowNodes = useMemo(() => nodes.map((n) => ({
    ...n, zIndex: n.id === open ? 10 : undefined, // an expanded box sits above its neighbours
    data: { ...n.data, passport: graph && n.id === open ? boxPassport(graph, n.id) : null },
  })), [nodes, open, graph]);

  // What an expanded box can do: open the box at the far end of an arrow, close itself, and make a link that opens this page with the box expanded.
  const actions = useMemo(() => ({
    open: (id) => setOpen(id), close: () => setOpen(null),
    link: (id) => { const u = new URL(window.location.href); u.searchParams.set('box', id); return u.toString(); },
  }), []);

  useEffect(() => {
    if (!playing) return;
    const total = doc?.edges?.length || 0;
    if (active >= total - 1) { setPlaying(false); return; }
    const t = setTimeout(() => setActive(a => a + 1), speed);
    return () => clearTimeout(t);
  }, [playing, active, speed, doc]);

  const simulate = () => { setActive(0); setPlaying(true); };
  const reset = () => { setPlaying(false); setActive(-1); setOpen(null); if (doc) setNodes(initialNodes(doc)); };

  if (error) return <p className="muted" role="alert">{error}</p>;
  if (!doc) return <p className="muted">Loading diagram…</p>;

  return (
    <div data-testid="diagram">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <button type="button" data-testid="simulate-btn" onClick={simulate} disabled={playing}>Simulate</button>
        <button className="btn-secondary" data-testid="diagram-reset-btn" onClick={reset}>Reset</button>
        <label htmlFor="speed">Speed</label>
        <select id="speed" data-testid="speed-select" value={speed} onChange={e => setSpeed(Number(e.target.value))}>
          <option value={1600}>slow</option>
          <option value={800}>normal</option>
          <option value={300}>fast</option>
        </select>
      </div>
      <div className="wi-diagram-canvas">
        <PassportActions.Provider value={actions}>
          <ReactFlow nodes={flowNodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodesConnectable={false}
            onNodesChange={(changes) => setNodes((ns) => applyNodeChanges(changes, ns))}
            onNodeClick={(_, n) => setOpen((o) => (o === n.id ? null : n.id))} onPaneClick={() => setOpen(null)}
            colorMode={theme === 'dark' ? 'dark' : 'light'} fitView proOptions={{ hideAttribution: true }}>
            <Background />
            <Controls showInteractive={false} />
            <EdgeLabels items={labels} pointFor={(box, handle) => sidePoint(box, String(handle).split('-')[1])} fallback={{ w: 150, h: 56 }} />
            <FitOpen open={open} />
          </ReactFlow>
        </PassportActions.Provider>
      </div>
      <p className="muted">{doc.lede}</p>
    </div>
  );
}

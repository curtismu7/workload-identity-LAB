import React, { useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, applyNodeChanges } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// Renders a diagram-studio/1 document (loaded by name from /api/diagrams/:id).
// Boxes are movable, Reset restores positions, Simulate walks the edges in order
// with a speed control (rule 5).
const GROUP_COLORS = { red: '#b3232a', blue: '#1f5aa8', amber: '#b06d00', grey: '#5b6770', dark: '#22282e' };

export default function Diagram({ diagramId = 'workload-identity-flow', theme = 'light' }) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');
  const [nodes, setNodes] = useState([]);
  const [active, setActive] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(800);

  useEffect(() => {
    fetch(`/api/diagrams/${diagramId}`)
      .then(r => { if (!r.ok) throw new Error(`diagram ${r.status}`); return r.json(); })
      .then(d => {
        setDoc(d);
        setNodes(d.nodes.map((n, i) => ({
          id: n.id,
          position: { x: 60 + (i % 2) * 260, y: 40 + i * 78 },
          data: { label: `${n.label}` },
          style: { border: `2px solid ${GROUP_COLORS[d.groups?.[n.group]?.color] || '#5b6770'}`, borderRadius: 8, background: 'var(--surface,#fff)', color: 'inherit', fontSize: 12, padding: 6, maxWidth: 240 },
        })));
      })
      .catch(e => setError(String(e.message)));
  }, [diagramId]);

  const edges = useMemo(() => (doc?.edges || []).map((e, i) => ({
    id: `e${i}`,
    source: e.from,
    target: e.to,
    label: e.label,
    animated: playing && i <= active,
    style: { stroke: playing && i <= active ? '#b3232a' : '#9aa4ad', strokeWidth: playing && i === active ? 2.5 : 1.5 },
    labelStyle: { fontSize: 10 },
  })), [doc, playing, active]);

  useEffect(() => {
    if (!playing) return;
    const total = doc?.edges?.length || 0;
    if (active >= total - 1) { setPlaying(false); return; }
    const t = setTimeout(() => setActive(a => a + 1), speed);
    return () => clearTimeout(t);
  }, [playing, active, speed, doc]);

  const simulate = () => { setActive(0); setPlaying(true); };
  const reset = () => { setPlaying(false); setActive(-1); setDoc(d => { // restore positions
    if (d) setNodes(d.nodes.map((n, i) => ({ id: n.id, position: { x: 60 + (i % 2) * 260, y: 40 + i * 78 }, data: { label: n.label }, style: { border: `2px solid ${GROUP_COLORS[d.groups?.[n.group]?.color] || '#5b6770'}`, borderRadius: 8, background: 'var(--surface,#fff)', color: 'inherit', fontSize: 12, padding: 6, maxWidth: 240 } })));
    return d; });
  };

  if (error) return <p className="muted" role="alert">{error}</p>;
  if (!doc) return <p className="muted">Loading diagram…</p>;

  return (
    <div data-testid="diagram">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <button className="btn-primary" data-testid="simulate-btn" onClick={simulate} disabled={playing}>Simulate</button>
        <button className="btn-secondary" data-testid="diagram-reset-btn" onClick={reset}>Reset</button>
        <label htmlFor="speed">Speed</label>
        <select id="speed" data-testid="speed-select" value={speed} onChange={e => setSpeed(Number(e.target.value))}>
          <option value={1600}>slow</option>
          <option value={800}>normal</option>
          <option value={300}>fast</option>
        </select>
      </div>
      <div style={{ height: 420, border: '1px solid var(--border,#d8dde3)', borderRadius: 8 }}>
        <ReactFlow nodes={nodes} edges={edges} onNodesChange={(changes) => setNodes((ns) => applyNodeChanges(changes, ns))} colorMode={theme === 'dark' ? 'dark' : 'light'} fitView proOptions={{ hideAttribution: true }}>
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <p className="muted">{doc.lede}</p>
    </div>
  );
}

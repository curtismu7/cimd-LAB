import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, applyNodeChanges, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { loadDiagram } from './diagrams/index.js';
import { useStepper, SPEEDS } from './stepper.js';

// Positions come from the diagram data; dragging changes a copy, Reset restores the data.
export function usePositions(diagram) {
  const original = useMemo(() => Object.fromEntries(diagram.nodes.map((n) => [n.id, { x: n.x, y: n.y }])), [diagram]);
  const [positions, setPositions] = useState(original);
  const move = useCallback((id, position) => setPositions((p) => ({ ...p, [id]: position })), []);
  const reset = useCallback(() => setPositions(original), [original]);
  return { positions, move, reset, original };
}

function BoxNode({ data }) {
  return (
    <div className={`dg-node dg-${data.color}`}>
      <Handle type="target" position={Position.Left} />
      <strong>{data.label}</strong>
      {data.sub.map((line) => <span key={line}>{line}</span>)}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { box: BoxNode };

export function toFlow(diagram, positions, activeEdges, simulating) {
  const nodes = diagram.nodes.map((n) => ({
    id: n.id,
    type: 'box',
    position: positions[n.id],
    data: { label: n.label, sub: n.sub ?? [], color: diagram.groups[n.group]?.color ?? 'grey' },
  }));
  const edges = diagram.edges.map((e, i) => {
    const on = activeEdges.has(i);
    return {
      id: `e${i}`,
      source: e.source,
      target: e.target,
      label: e.label,
      animated: on,
      markerEnd: { type: MarkerType.ArrowClosed },
      className: on ? 'edge-on' : simulating ? 'edge-dim' : '',
      style: { strokeWidth: on ? 3 : 1.5 },
    };
  });
  return { nodes, edges };
}

export default function DiagramView({ id, resetKey = 0, presenter = false }) {
  const diagram = useMemo(() => loadDiagram(id), [id]);
  const { positions, move, reset } = usePositions(diagram);
  const [s, dispatch] = useStepper(diagram.steps.length);

  const doReset = useCallback(() => { reset(); dispatch({ type: 'stop' }); }, [reset, dispatch]);
  useEffect(() => { if (resetKey) doReset(); }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!presenter) return undefined;
    const onKey = (event) => {
      if (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); dispatch({ type: 'next' }); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); dispatch({ type: 'prev' }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presenter, dispatch]);

  const step = s.step >= 0 ? diagram.steps[s.step] : null;
  const active = useMemo(() => new Set(step?.edges ?? []), [step]);
  const { nodes, edges } = useMemo(() => toFlow(diagram, positions, active, s.step >= 0), [diagram, positions, active, s.step]);
  const onNodesChange = useCallback((changes) => {
    for (const change of changes) if (change.type === 'position' && change.position) move(change.id, change.position);
  }, [move]);

  return (
    <section className="diagram" aria-label={diagram.title}>
      <h3>{diagram.title}</h3>
      <p className="lede">{diagram.lede}</p>
      <div className="dg-toolbar" role="toolbar" aria-label="Diagram controls">
        <button type="button" className="primary" onClick={() => dispatch({ type: 'simulate' })}>Simulate</button>
        <button type="button" onClick={() => dispatch({ type: 'prev' })}>Back</button>
        <button type="button" onClick={() => dispatch({ type: 'next' })}>Next</button>
        {s.paused
          ? <button type="button" onClick={() => dispatch({ type: 'resume' })}>Resume</button>
          : <button type="button" onClick={() => dispatch({ type: 'pause' })}>Pause</button>}
        <button type="button" onClick={doReset}>Reset diagram</button>
        <label className="inline">Speed
          <select value={s.speed} onChange={(e) => dispatch({ type: 'speed', speed: e.target.value })}>
            {SPEEDS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>
      </div>
      <div className="dg-canvas" data-testid="diagram-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          nodesDraggable
          nodesConnectable={false}
          fitView
          proOptions={{ hideAttribution: true }}
          minZoom={0.3}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <ol className="dg-steps" aria-label="Steps">
        {diagram.steps.map((st, i) => (
          <li key={st.title} aria-current={i === s.step ? 'step' : undefined} className={i === s.step ? 'current' : ''}>
            <button type="button" onClick={() => dispatch({ type: 'goto', step: i })}>{st.title}</button>
            {i === s.step && <p role="status">{st.what}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}

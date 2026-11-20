import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowNoLabel, EdgeLabels, FitOpen, Passport, PassportActions } from './diagram-kit/DiagramKit.jsx';
import { boxPassport, inOutPoint } from './diagram-kit/diagramKit.js';
import './diagram-kit/diagram-kit.css';
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

// Arrows run left to right (out on the right, in on the left). An arrow that points back to the left uses the hidden
// "back" handles, so it neither loops around both boxes nor lies on top of the arrow going the other way.
function BoxNode({ data }) {
  return (
    <div className={`dg-node dg-${data.color}`}>
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Left} id="back-out" className="handle-back" isConnectable={false} />
      <strong>{data.label}</strong>
      {data.sub.map((line) => <span key={line}>{line}</span>)}
      <Handle type="source" position={Position.Right} id="out" />
      <Handle type="target" position={Position.Right} id="back-in" className="handle-back" isConnectable={false} />
      {data.passport && <Passport p={data.passport} />}
    </div>
  );
}
const nodeTypes = { box: BoxNode };

// The curve only: every label is drawn by the diagram kit's EdgeLabels, in a layer above the boxes,
// placed so no two labels overlap and none sits on a box (the shared standard, UI patterns §8c).
const edgeTypes = { arrow: ArrowNoLabel };

export function toFlow(diagram, positions, activeEdges, simulating) {
  const nodes = diagram.nodes.map((n) => ({
    id: n.id,
    type: 'box',
    position: positions[n.id],
    data: { label: n.label, sub: n.sub ?? [], color: diagram.groups[n.group]?.color ?? 'grey' },
  }));
  const x = new Map(nodes.map((n) => [n.id, n.position.x]));
  const edges = diagram.edges.map((e, i) => {
    const on = activeEdges.has(i);
    const back = x.get(e.target) < x.get(e.source);
    return {
      id: `e${i}`,
      type: 'arrow',
      source: e.source,
      sourceHandle: back ? 'back-out' : 'out',
      targetHandle: back ? 'back-in' : 'in',
      target: e.target,
      animated: on,
      markerEnd: { type: MarkerType.ArrowClosed },
      className: `${on ? 'edge-on' : simulating ? 'edge-dim' : ''}${e.dashed ? ' edge-dashed' : ''}${e.color ? ` edge-${e.color}` : ''}`,
      style: { strokeWidth: on ? 3 : 1.5, ...(e.dashed ? { strokeDasharray: '6 4' } : {}) },
      data: { color: e.color, active: on },
    };
  });
  return { nodes, edges };
}

// One label item per arrow, for the kit's EdgeLabels layer (above the boxes, never overlapping).
export function toLabelItems(diagram, edges, active) {
  return diagram.edges.map((e, i) => ({
    id: `e${i}`,
    text: e.label ?? '',
    source: e.source,
    target: e.target,
    sourceHandle: edges[i]?.sourceHandle,
    targetHandle: edges[i]?.targetHandle,
    active: active.has(i),
    dim: active.size > 0 && !active.has(i),
  }));
}

export const labelPointFor = (box, handle) => inOutPoint(box, String(handle));

// A view has exactly one primary button. The view that owns this diagram passes a function as children to render Simulate as ITS primary action:
// <DiagramView ...>{(simulate) => <button type="button" className="primary" onClick={simulate}>Simulate</button>}</DiagramView>.
// Without it Simulate is a plain button: most views have a bigger action of their own (run the probe, run the tester, evaluate).
export default function DiagramView({ id, resetKey = 0, presenter = false, children }) {
  const diagram = useMemo(() => loadDiagram(id), [id]);
  const { positions, move, reset } = usePositions(diagram);
  const [s, dispatch] = useStepper(diagram.steps.length);
  // fitView runs once on mount, against the canvas width at that moment. When the layout shifts afterwards
  // (a scrollbar appears, the window narrows, a panel above grows) the fitted zoom no longer fits and boxes
  // drift off the right edge. Re-fit whenever the canvas is resized.
  const canvasRef = useRef(null);
  const fitRef = useRef(null);
  const onInit = useCallback((instance) => { fitRef.current = () => instance.fitView({ padding: 0.08, duration: 0 }); fitRef.current(); }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => fitRef.current?.());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // Click a box and it expands in place with its details (the shared diagram kit's Passport, §8c).
  const [open, setOpen] = useState(null);

  const simulate = () => dispatch({ type: 'simulate' });
  const doReset = useCallback(() => { setOpen(null); reset(); dispatch({ type: 'stop' }); fitRef.current?.(); }, [reset, dispatch]);
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
  const graph = useMemo(() => ({
    nodes: diagram.nodes.map((n) => ({ id: n.id, label: n.label, sub: n.sub ?? [], group: n.group })),
    edges: diagram.edges.map((e) => ({ source: e.source, target: e.target, label: e.label ?? '' })),
    groups: diagram.groups,
  }), [diagram]);
  const passportFor = useMemo(() => (nid) => boxPassport(graph, nid), [graph]);
  const withPassport = useMemo(
    () => nodes.map((n) => ({
      ...n,
      zIndex: n.id === open ? 10 : undefined,
      className: n.id === open ? 'dk-open' : undefined,
      data: { ...n.data, passport: n.id === open ? passportFor(n.id) : null },
    })),
    [nodes, open, passportFor]
  );
  const items = useMemo(() => toLabelItems(diagram, edges, active), [diagram, edges, active]);
  const onNodesChange = useCallback((changes) => {
    for (const change of changes) if (change.type === 'position' && change.position) move(change.id, change.position);
  }, [move]);
  const actions = useMemo(() => ({
    open: (nid) => setOpen(nid),
    close: () => setOpen(null),
    link: (nid) => { const u = new URL(window.location.href); u.searchParams.set('box', nid); return u.toString(); },
  }), []);

  return (
    <section className="diagram" aria-label={diagram.title}>
      <h3>{diagram.title}</h3>
      <p className="lede">{diagram.lede}</p>
      <div className="dg-toolbar" role="toolbar" aria-label="Diagram controls">
        {typeof children === 'function' ? children(simulate) : <button type="button" onClick={simulate}>Simulate</button>}
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
      <div className="dg-canvas" data-testid="diagram-canvas" ref={canvasRef}>
        <PassportActions.Provider value={actions}>
          <ReactFlow
            nodes={withPassport}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={(_, n) => setOpen((o) => (o === n.id ? null : n.id))}
            onPaneClick={() => setOpen(null)}
            onInit={onInit}
            nodesDraggable
            nodesConnectable={false}
            fitView
            proOptions={{ hideAttribution: true }}
            minZoom={0.3}
          >
            <Background />
            <Controls showInteractive={false} />
            <EdgeLabels items={items} pointFor={labelPointFor} fallback={{ w: 210, h: 80 }} />
            <FitOpen open={open} closePadding={0.08} />
          </ReactFlow>
        </PassportActions.Provider>
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

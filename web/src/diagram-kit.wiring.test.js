import { describe, it, expect } from 'vitest';
import { loadDiagram } from './diagrams/index.js';
import { toFlow, toLabelItems, labelPointFor } from './DiagramView.jsx';
import { inOutPoint } from './diagram-kit/diagramKit.js';

describe('diagram kit wiring (§8c)', () => {
  it('every diagram edge gets a label item with its handles, active only while its step plays', () => {
    const d = loadDiagram('cimd-pf-server-flow');
    const edges = toFlow(d, Object.fromEntries(d.nodes.map((n) => [n.id, { x: n.x, y: n.y }])), new Set(d.steps[0].edges), false).edges;
    const items = toLabelItems(d, edges, new Set(d.steps[0].edges));
    expect(items).toHaveLength(d.edges.length);
    for (const [i, it] of items.entries()) {
      expect(it.id).toBe(`e${i}`);
      expect(it.text).toBe(d.edges[i].label ?? '');
      expect(it.sourceHandle).toBe(edges[i].sourceHandle);
      expect(it.targetHandle).toBe(edges[i].targetHandle);
      expect(it.active).toBe(new Set(d.steps[0].edges).has(i));
    }
    expect(edges.every((e) => e.type === 'arrow' && e.label === undefined)).toBe(true);
  });
  it('the label point helper is the kit inOutPoint', () => {
    const box = { x: 10, y: 20, w: 100, h: 50 };
    expect(labelPointFor(box, 'out')).toEqual(inOutPoint(box, 'out'));
  });
});

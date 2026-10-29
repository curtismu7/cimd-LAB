import pfServer from './cimd-pf-server-flow.json';
import labServer from './cimd-lab-server-flow.json';
import vsDcr from './cimd-vs-dcr.json';

// Diagrams are diagram-studio/1 data, loaded by id. No nodes or edges are built in JSX.
const ALL = [pfServer, labServer, vsDcr];
const BY_ID = new Map(ALL.map((diagram) => [diagram.id, diagram]));

export function loadDiagram(id) {
  const diagram = BY_ID.get(id);
  if (!diagram) throw new Error(`Unknown diagram: ${id}`);
  return diagram;
}
export const DIAGRAM_IDS = ALL.map((diagram) => diagram.id);

// Debug view of the navigation graph (N key): every node as a dot, every link
// as a line colored by kind. Also colors the nodes by distance to the player
// (the flow field), so you can SEE the "map of arrows" the ghouls follow.
import * as THREE from 'three';
import type { FlowField, LinkKind, NavGraph } from '../sim/nav';

const LINK_COLORS: Record<LinkKind, number> = {
  walk: 0x406040, // dim green: there are thousands
  jump: 0x40a0ff, // blue
  drop: 0xffd040, // yellow
  climb: 0xff4040, // red
  vent: 0xff40ff, // magenta
};

export interface NavDebug {
  toggle(): void;
  /** Recolors the nodes from the current flow field (when visible). */
  update(flow: FlowField): void;
}

export function createNavDebug(scene: THREE.Scene, graph: NavGraph): NavDebug {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  // Links: one LineSegments object for ALL of them (pairs of points), with a
  // color per vertex. Thousands of lines, one draw call.
  const positions: number[] = [];
  const colors: number[] = [];
  const c = new THREE.Color();
  graph.links.forEach((list, from) => {
    const a = graph.nodes[from];
    for (const link of list) {
      const b = graph.nodes[link.to];
      positions.push(a.x, a.y + 0.1, a.z, b.x, b.y + 0.1, b.z);
      c.set(LINK_COLORS[link.kind]);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
  });
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  group.add(
    new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ vertexColors: true, fog: false })),
  );

  // Nodes: points, colored by distance to the player (white = near, purple = far).
  const nodePositions = new Float32Array(graph.nodes.length * 3);
  graph.nodes.forEach((n, i) => nodePositions.set([n.x, n.y + 0.12, n.z], i * 3));
  const nodeColors = new Float32Array(graph.nodes.length * 3);
  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute('position', new THREE.BufferAttribute(nodePositions, 3));
  pointGeometry.setAttribute('color', new THREE.BufferAttribute(nodeColors, 3));
  group.add(
    new THREE.Points(pointGeometry, new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true, fog: false })),
  );

  let lastFlow: FlowField | null = null;
  return {
    toggle() {
      group.visible = !group.visible;
      lastFlow = null; // force a recolor
    },
    update(flow) {
      if (!group.visible || flow === lastFlow) return;
      lastFlow = flow;
      for (let i = 0; i < graph.nodes.length; i++) {
        const d = flow.dist[i];
        if (!isFinite(d)) c.set(0x000000); // unreachable
        else c.setHSL(0.8, 1, Math.max(0.15, 1 - d / 80));
        nodeColors.set([c.r, c.g, c.b], i * 3);
      }
      pointGeometry.attributes.color.needsUpdate = true;
    },
  };
}

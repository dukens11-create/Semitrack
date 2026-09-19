import type { LocationFix } from '../../services/location/LocationService';
import { freshFix } from './navigationPresentation';
import { stopDistanceMeters } from '../../models/stopCoverage';
type Segment = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  offset: number;
  length: number;
};
type Node = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  segments?: Segment[];
  children?: Node[];
};
function tree(segments: Segment[], depth = 0): Node {
  const box = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  };
  for (const s of segments) {
    box.minX = Math.min(box.minX, s.ax, s.bx);
    box.maxX = Math.max(box.maxX, s.ax, s.bx);
    box.minY = Math.min(box.minY, s.ay, s.by);
    box.maxY = Math.max(box.maxY, s.ay, s.by);
  }
  if (segments.length <= 12) return { ...box, segments };
  const x = depth % 2 === 0;
  segments.sort((a, b) =>
    x ? a.ax + a.bx - (b.ax + b.bx) : a.ay + a.by - (b.ay + b.by),
  );
  const middle = Math.floor(segments.length / 2);
  return {
    ...box,
    children: [
      tree(segments.slice(0, middle), depth + 1),
      tree(segments.slice(middle), depth + 1),
    ],
  };
}
/** Spatial index built once per route. GPS updates query nearby nodes, not every route vertex.
 * Advisory projection never advances the commercial navigation engine or declares arrival. */
export class RouteProgressMonitor {
  private root: Node;
  private scale: number;
  private offCount = 0;
  private offSince = 0;
  private lastTimestamp = -Infinity;
  constructor(geometry: number[][]) {
    this.scale = Math.cos(((geometry[0]?.[1] ?? 0) * Math.PI) / 180) * 111320;
    let offset = 0;
    const segments: Segment[] = [];
    for (let i = 1; i < geometry.length; i++) {
      const a = geometry[i - 1]!,
        b = geometry[i]!;
      const length = stopDistanceMeters(
        { lat: a[1]!, lng: a[0]! },
        { lat: b[1]!, lng: b[0]! },
      );
      segments.push({
        ax: a[0]! * this.scale,
        ay: a[1]! * 111320,
        bx: b[0]! * this.scale,
        by: b[1]! * 111320,
        offset,
        length,
      });
      offset += length;
    }
    this.root = tree(segments);
  }
  update(
    fix: LocationFix | null,
    now = Date.now(),
  ): {
    status: 'unknown' | 'on-route' | 'off-route';
    offset?: number;
    distance?: number;
  } {
    if (!freshFix(fix, now) || !fix || fix.accuracy > 50) {
      this.offCount = 0;
      return { status: 'unknown' };
    }
    const x = fix.longitude * this.scale,
      y = fix.latitude * 111320;
    let best = Infinity,
      offset = 0;
    const hits: { d: number; offset: number }[] = [];
    const visit = (node: Node) => {
      const bound = Math.hypot(
        Math.max(node.minX - x, 0, x - node.maxX),
        Math.max(node.minY - y, 0, y - node.maxY),
      );
      if (bound > best + 30) return;
      if (node.children) {
        const children = [...node.children].sort(
          (a, b) =>
            Math.hypot((a.minX + a.maxX) / 2 - x, (a.minY + a.maxY) / 2 - y) -
            Math.hypot((b.minX + b.maxX) / 2 - x, (b.minY + b.maxY) / 2 - y),
        );
        children.forEach(visit);
        return;
      }
      for (const s of node.segments ?? []) {
        const dx = s.bx - s.ax,
          dy = s.by - s.ay;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((x - s.ax) * dx + (y - s.ay) * dy) / (dx * dx + dy * dy || 1),
          ),
        );
        const d = Math.hypot(x - s.ax - t * dx, y - s.ay - t * dy),
          along = s.offset + t * s.length;
        if (d < best) {
          best = d;
          offset = along;
        }
        hits.push({ d, offset: along });
      }
    };
    visit(this.root);
    if (!Number.isFinite(best)) return { status: 'unknown' };
    if (best <= Math.max(50, fix.accuracy * 2)) {
      this.offCount = 0;
      // Loops/crossings cannot prove which occurrence of a road the truck occupies.
      if (hits.some(h => h.d <= best + 20 && Math.abs(h.offset - offset) > 300))
        return { status: 'unknown', distance: best };
      return { status: 'on-route', offset, distance: best };
    }
    if (fix.timestamp - this.lastTimestamp > 15000) this.offCount = 0;
    if (fix.timestamp > this.lastTimestamp) {
      if (!this.offCount) this.offSince = fix.timestamp;
      this.offCount++;
      this.lastTimestamp = fix.timestamp;
    }
    return {
      status:
        this.offCount >= 3 && fix.timestamp - this.offSince >= 10000
          ? 'off-route'
          : 'unknown',
      distance: best,
    };
  }
}

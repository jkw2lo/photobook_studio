import { createRequire } from 'node:module';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';

// Place outlines for map stickers and photo cut-outs: country and territory shapes from Natural
// Earth (via the world-atlas package, public domain), bundled — nothing is fetched. An outline is
// projected (longitude scaled by the cosine of its latitude, so shapes look right), reduced to
// its main area (no far-off islands shrinking the mainland), simplified, and returned 100 units
// tall with its width/height ratio, like a text outline.

const require = createRequire(import.meta.url);

interface Place {
  id: string;
  name: string;
  feature: Feature<Polygon | MultiPolygon>;
}

let places: Place[] | null = null;

function load(file: string): Place[] {
  const topo = require(`world-atlas/${file}`) as Topology<{ countries: GeometryCollection<{ name: string }> }>;
  return topo.objects.countries.geometries
    .map((g) => {
      const name = (g.properties as { name?: string } | undefined)?.name ?? String(g.id);
      return { id: String(g.id ?? name), name, feature: feature(topo, g) as unknown as Feature<Polygon | MultiPolygon> };
    })
    .filter((p) => p.feature.geometry);
}

/** Detailed outlines (for drawing). */
const detailed = () => (places ??= load('countries-10m.json'));

export function listPlaces(): { id: string; name: string }[] {
  return detailed().map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name));
}

const rings = (f: Feature<Polygon | MultiPolygon>): Position[][][] => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates);

function ringArea(r: Position[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(a / 2);
}

function bbox(pts: Position[]): [number, number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

/** Douglas–Peucker on a closed ring: split at the point farthest from the start, simplify both halves. */
function simplify(ring: Position[], tol: number): Position[] {
  if (ring.length < 5) return ring;
  let far = 1;
  let fd = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  return [...simplifyLine(ring.slice(0, far + 1), tol), ...simplifyLine(ring.slice(far), tol).slice(1)];
}

/** Douglas–Peucker on an open line. */
function simplifyLine(pts: Position[], tol: number): Position[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1;
    let bi = -1;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    if (best > tol && bi > 0) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function placeOutline(id: string): { name: string; d: string; aspect: number } {
  const place = detailed().find((p) => p.id === id || p.name.toLowerCase() === id.toLowerCase());
  if (!place) throw new Error(`No outline for “${id}”`);
  // Outer rings only (holes are rare at this scale), projected.
  const polys = rings(place.feature).map((poly) => poly[0]);
  const lat0 = (() => {
    const b = bbox(polys.flat());
    return (((b[1] + b[3]) / 2) * Math.PI) / 180;
  })();
  const k = Math.cos(lat0);
  const projected = polys.map((r) => r.map(([lon, lat]) => [lon * k, -lat] as Position));
  // Main area: polygons near the largest one (drops e.g. far-off islands), and not specks.
  const areas = projected.map(ringArea);
  const main = projected[areas.indexOf(Math.max(...areas))];
  const [mx0, my0, mx1, my1] = bbox(main);
  const reach = Math.max(mx1 - mx0, my1 - my0) * 0.5;
  const big = Math.max(...areas);
  const kept = projected.filter((r, i) => {
    if (areas[i] < big * 0.0015) return false;
    const [x0, y0, x1, y1] = bbox(r);
    return x1 > mx0 - reach && x0 < mx1 + reach && y1 > my0 - reach && y0 < my1 + reach;
  });
  const [x0, y0, x1, y1] = bbox(kept.flat());
  const tol = Math.hypot(x1 - x0, y1 - y0) * 0.0012;
  const s = 100 / (y1 - y0);
  const r = (n: number) => Math.round(n * 100) / 100;
  const d = kept
    .map((ring) => simplify(ring, tol))
    .filter((ring) => ring.length >= 3)
    .map((ring) => `M${ring.map(([x, y]) => `${r((x - x0) * s)} ${r((y - y0) * s)}`).join('L')}Z`)
    .join('');
  return { name: place.name, d, aspect: (x1 - x0) / (y1 - y0) };
}

function inRing(x: number, y: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function nearest(all: Place[], lon: number, lat: number, maxDeg: number): Place | undefined {
  let best: Place | undefined;
  let bestD = maxDeg;
  for (const p of all) {
    const polys = rings(p.feature).map((poly) => poly[0]);
    const b = bbox(polys.flat());
    if (lon < b[0] - maxDeg || lon > b[2] + maxDeg || lat < b[1] - maxDeg || lat > b[3] + maxDeg) continue;
    for (const r of polys) for (const [x, y] of r) {
      const d = Math.hypot(x - lon, y - lat);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}

/** Places the photos were taken in, most photos first. */
export function suggestPlaces(points: [number, number][]): { id: string; name: string; photos: number }[] {
  const counts = new Map<string, number>();
  const all = detailed();
  for (const [lon, lat] of points.slice(0, 2000)) {
    const hit = all.find((p) => {
      const b = bbox(rings(p.feature).flatMap((poly) => poly[0]));
      if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) return false;
      return rings(p.feature).some((poly) => inRing(lon, lat, poly[0]));
    });
    // Harbours and beaches often fall just outside a simplified coastline: take the nearest place
    // within about 10 km.
    const near = hit ?? nearest(all, lon, lat, 0.1);
    if (near) counts.set(near.id, (counts.get(near.id) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([id, photos]) => ({ id, name: all.find((p) => p.id === id)!.name, photos }));
}

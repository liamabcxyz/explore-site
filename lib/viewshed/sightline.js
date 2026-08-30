/**
 * Core 2.5D line-of-sight blockage math. Operates entirely in local meters
 * (x, y horizontal, z vertical) — callers project WGS84 via
 * lib/geo/toLocalMeters.js before calling in here.
 *
 * A building blocks the sightline from observer to target if the line's
 * height is still below the roofline at the point it first crosses the
 * footprint (the near face). Since height increases monotonically along the
 * segment, that near-face point is where the minimum required target height
 * (`req`) — the target altitude that would just barely clear this one
 * building — is determined: req = z0 + (height - z0) / tEntry.
 */

function segmentIntersection(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return null;

  const dx = p3.x - p1.x;
  const dy = p3.y - p1.y;
  const t = (dx * d2y - dy * d2x) / denom;
  const u = (dx * d1y - dy * d1x) / denom;
  return { t, u };
}

/**
 * @param {{x:number,y:number,z:number}} observer
 * @param {{x:number,y:number,z:number}} target
 * @param {{footprint: Array<Array<{x:number,y:number}>>, height: number}} building
 *   footprint is a ring list (first ring = exterior; holes are ignored — courtyards
 *   don't matter for whether a building blocks a sightline through its mass)
 * @returns {{tEntry:number, tExit:number, req:number} | null}
 */
export function intersectSegmentBuilding(observer, target, building) {
  const ring = building.footprint[0];
  const ts = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const hit = segmentIntersection(observer, target, ring[i], ring[i + 1]);
    if (hit && hit.u >= 0 && hit.u <= 1 && hit.t >= 0 && hit.t <= 1) {
      ts.push(hit.t);
    }
  }
  if (ts.length < 2) return null;

  const tEntry = Math.min(...ts);
  const tExit = Math.max(...ts);
  if (tEntry <= 0 || tEntry >= 1) return null;

  const req = observer.z + (building.height - observer.z) / tEntry;
  return { tEntry, tExit, req };
}

/**
 * Max `req` over every building intersecting observer->target. -Infinity
 * (nothing blocks) is a deliberate sentinel, not a bug: fractionVisible's
 * `minAlt <= H - R` boundary check resolves it straight to frac=1 without
 * ever doing arithmetic on it.
 */
export function computeMinAlt(observer, target, buildings) {
  let minAlt = -Infinity;
  for (const building of buildings) {
    const hit = intersectSegmentBuilding(observer, target, building);
    if (hit && hit.req > minAlt) minAlt = hit.req;
  }
  return minAlt;
}

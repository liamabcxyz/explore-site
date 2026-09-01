import { makeLocalProjector } from "@/lib/geo/toLocalMeters";

/**
 * A building can only block a sightline within `radiusMeters` of `point` if
 * some part of its footprint falls within that radius (every sightline the
 * viewshed grid tests runs from an observer inside that radius to `point`
 * itself, so nothing farther out than the radius can ever sit on one of
 * those segments). `querySourceFeatures` returns whatever's in the loaded
 * viewport regardless of how far that is from the launch point — for a
 * street-level view that can be thousands of buildings the occlusion math
 * never needed to look at. Filtering here, before handing buildings to
 * computeViewshed (main thread or worker), is a straight cut to the O(cells
 * x buildings) cost, not just a relocation of it.
 *
 * Checked by vertex distance rather than true edge-to-point distance —
 * footprints are meters-to-tens-of-meters across, negligible next to a
 * radius measured in hundreds of meters, so the sliver of an edge that
 * could be closer to `point` than every one of its own vertices doesn't
 * matter. MARGIN_METERS absorbs it anyway.
 */
const MARGIN_METERS = 50;

function distPointToSegmentSq(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLenSq = abx * abx + aby * aby;
  const t = abLenSq === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
  const dx = px - (ax + t * abx);
  const dy = py - (ay + t * aby);
  return dx * dx + dy * dy;
}

function segmentHitsRect(ax, ay, bx, by, minX, minY, maxX, maxY) {
  // Liang-Barsky clip of the segment against the AABB. True if any of the
  // clipped segment remains, i.e. the line actually crosses the rectangle.
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, ax - minX) &&
    clip(dx, maxX - ax) &&
    clip(-dy, ay - minY) &&
    clip(dy, maxY - ay)
  );
}

/**
 * Keep buildings whose footprint could sit on a sightline between `from`
 * and `to` given a corridor half-width of `bufferMeters` (+ the same
 * vertex-margin the radius filter uses). Used by the far-observer corridor
 * fetch so a z14 tile's extra ~2km of off-corridor buildings don't go into
 * the intersection math.
 */
export function filterBuildingsNearSegment(buildings, from, to, bufferMeters) {
  const projector = makeLocalProjector(from.lat, from.lng);
  const end = projector.toLocal(to.lat, to.lng);
  const limit = bufferMeters + MARGIN_METERS;
  const limitSq = limit * limit;
  return buildings.filter((building) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let vertexHit = false;
    for (const ring of building.footprint) {
      for (const [lng, lat] of ring) {
        const { x, y } = projector.toLocal(lat, lng);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (distPointToSegmentSq(x, y, 0, 0, end.x, end.y) <= limitSq) vertexHit = true;
      }
    }
    if (vertexHit) return true;
    // Line through the middle of a large footprint can miss every vertex
    // while still crossing the mass. Inflate the bbox by the buffer and
    // test the segment against that rectangle.
    return segmentHitsRect(0, 0, end.x, end.y, minX - limit, minY - limit, maxX + limit, maxY + limit);
  });
}

export function filterBuildingsNearPoint(buildings, point, radiusMeters) {
  const projector = makeLocalProjector(point.lat, point.lng);
  const limitSq = (radiusMeters + MARGIN_METERS) ** 2;
  return buildings.filter((building) =>
    building.footprint.some((ring) =>
      ring.some(([lng, lat]) => {
        const { x, y } = projector.toLocal(lat, lng);
        return x * x + y * y <= limitSq;
      })
    )
  );
}

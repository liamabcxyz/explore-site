/**
 * A spatial pre-filter for computeMinAlt() — see 可视域计算优化方案.md's "空间索引"
 * step and notes.md §17. Without this, every sightline test brute-forces the
 * entire (already radius-clipped) building list; at realistic density
 * (thousands of buildings, ~2000+ grid cells) that's tens of millions of
 * intersectSegmentBuilding calls per request.
 *
 * Every sightline here shares the same `target` (the launch point, at the
 * local-coordinate origin) — only `observer` varies, so every query segment
 * is a spoke out from a fixed center. That makes a plain bounding-box bucket
 * query weak: a spoke 1000m out has a ~1000x1000m bounding rectangle, which
 * for a diagonal direction still captures most of the buildings in that
 * quadrant — exactly the cells (farthest out) where pruning matters most.
 * Instead, queryBuildingIndex walks only the grid cells the segment actually
 * passes through (a gapless line/voxel traversal), which costs
 * O(distance / cellSize) regardless of angle.
 *
 * Buildings are registered into every cell their footprint's bounding box
 * overlaps, so as long as the traversal never skips a cell the segment's
 * line passes through, no building the segment could hit is missed —
 * queryBuildingIndex returns a superset of the true blockers (bbox overlap
 * is a necessary, not sufficient, condition); computeMinAlt's exact ring
 * math is still what decides whether a candidate actually blocks.
 */

// Large enough that a typical building footprint (tens of meters) rarely
// spans more than a couple of cells, small enough to meaningfully prune the
// building list in a dense downtown (thousands of buildings within 1500m).
// Unrelated to RADIAL_SPACING/ANGULAR_SPACING (components/launch/
// LaunchPointControl.jsx) — those govern sampling density, this governs
// index granularity.
const DEFAULT_CELL_SIZE_METERS = 50;

function footprintBBox(footprint) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of footprint) {
    for (const { x, y } of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * @param {Array<{footprint: Array<Array<{x:number,y:number}>>, height: number}>} localBuildings
 *   already reprojected into local meters (computeViewshed.js/computeRooftopLayer.js's
 *   own `localBuildings`)
 * @param {number} [cellSize]
 */
export function buildBuildingIndex(localBuildings, cellSize = DEFAULT_CELL_SIZE_METERS) {
  const buckets = new Map();
  for (const building of localBuildings) {
    const { minX, minY, maxX, maxY } = footprintBBox(building.footprint);
    const cellMinX = Math.floor(minX / cellSize);
    const cellMaxX = Math.floor(maxX / cellSize);
    const cellMinY = Math.floor(minY / cellSize);
    const cellMaxY = Math.floor(maxY / cellSize);
    for (let cx = cellMinX; cx <= cellMaxX; cx++) {
      for (let cy = cellMinY; cy <= cellMaxY; cy++) {
        const key = `${cx},${cy}`;
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = [];
          buckets.set(key, bucket);
        }
        bucket.push(building);
      }
    }
  }
  return { buckets, cellSize };
}

/**
 * Gapless grid traversal from p0 to p1 (a 2D DDA/voxel walk, à la
 * Amanatides & Woo) — visits every cell the segment's line passes through,
 * including a cell it only grazes at a corner. A naive Bresenham-style walk
 * can skip one of the two cells sharing a corner at an exact diagonal
 * crossing (tMaxX === tMaxY); handled below by visiting both candidates at
 * that crossing instead of jumping straight to the diagonal neighbor.
 */
function walkGridCells(x0, y0, x1, y1, cellSize) {
  let cellX = Math.floor(x0 / cellSize);
  let cellY = Math.floor(y0 / cellSize);
  const endCellX = Math.floor(x1 / cellSize);
  const endCellY = Math.floor(y1 / cellSize);

  const visited = [[cellX, cellY]];
  if (cellX === endCellX && cellY === endCellY) return visited;

  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;

  const nextBoundaryX = stepX > 0 ? (cellX + 1) * cellSize : cellX * cellSize;
  const nextBoundaryY = stepY > 0 ? (cellY + 1) * cellSize : cellY * cellSize;
  let tMaxX = stepX !== 0 ? (nextBoundaryX - x0) / dx : Infinity;
  let tMaxY = stepY !== 0 ? (nextBoundaryY - y0) / dy : Infinity;
  const tDeltaX = stepX !== 0 ? cellSize / Math.abs(dx) : Infinity;
  const tDeltaY = stepY !== 0 ? cellSize / Math.abs(dy) : Infinity;

  // A straight grid walk can't visit more cells than the Manhattan distance
  // between start/end cells (plus slack for the diagonal-crossing double
  // visits below) — bounds the loop against float-precision edge cases
  // instead of trusting it to terminate exactly on its own.
  const maxSteps = Math.abs(endCellX - cellX) + Math.abs(endCellY - cellY) + 4;
  for (let steps = 0; steps < maxSteps; steps++) {
    if (tMaxX < tMaxY) {
      tMaxX += tDeltaX;
      cellX += stepX;
    } else if (tMaxY < tMaxX) {
      tMaxY += tDeltaY;
      cellY += stepY;
    } else {
      // Exact diagonal crossing: stepping straight to (cellX+stepX,
      // cellY+stepY) would skip the two cells that share this corner.
      visited.push([cellX + stepX, cellY]);
      visited.push([cellX, cellY + stepY]);
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
      cellX += stepX;
      cellY += stepY;
    }
    visited.push([cellX, cellY]);
    if (cellX === endCellX && cellY === endCellY) break;
  }
  return visited;
}

/**
 * @param {ReturnType<typeof buildBuildingIndex>} index
 * @param {{x:number,y:number}} observer
 * @param {{x:number,y:number}} target
 * @returns {Array<object>} deduped candidate buildings — a superset of what
 *   actually blocks this sightline, for computeMinAlt to test exactly.
 */
export function queryBuildingIndex(index, observer, target) {
  const { buckets, cellSize } = index;
  const cells = walkGridCells(observer.x, observer.y, target.x, target.y, cellSize);
  const seen = new Set();
  const result = [];
  for (const [cx, cy] of cells) {
    const bucket = buckets.get(`${cx},${cy}`);
    if (!bucket) continue;
    for (const building of bucket) {
      if (seen.has(building)) continue;
      seen.add(building);
      result.push(building);
    }
  }
  return result;
}

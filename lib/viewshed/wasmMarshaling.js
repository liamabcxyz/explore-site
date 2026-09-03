// JS ↔ Rust data contract for the WASM compute pipeline.
//
// This is the JS half of what wasm/vantage-core/src/marshaling.rs is
// the Rust half of. Both sides must agree on the flat-array layout
// below; the round-trip self-check in worker.js proves they do on
// every worker startup.
//
// Not exported to the rest of the app — the WASM entry points
// (compute_viewshed, compute_rooftop_layer, compute_sightline_profile,
// arriving in C4/C5) will accept the packed arrays directly and hide
// this layer from callers.

/**
 * Convert an array of already-local-meters buildings into three parallel
 * typed arrays for WASM.
 *
 * Only the exterior ring is marshaled — sightline math ignores holes
 * ("a courtyard doesn't stop a sightline through the building's mass"
 * — see lib/viewshed/sightline.js). `.name`, `.confidence`, `.id`, and
 * any other metadata stay on the JS side; the WASM output uses building
 * INDEX (0..n-1) as the identifier so JS can re-attach whatever it
 * needs after WASM returns.
 *
 * @param {Array<{footprint: Array<Array<{x:number,y:number}>>, height: number}>} localBuildings
 * @returns {{heights: Float32Array, vertexCounts: Uint32Array, vertexData: Float64Array}}
 */
export function packBuildings(localBuildings) {
  const n = localBuildings.length;
  const heights = new Float32Array(n);
  const vertexCounts = new Uint32Array(n);
  let totalVerts = 0;
  for (let i = 0; i < n; i++) {
    heights[i] = localBuildings[i].height;
    const ring = localBuildings[i].footprint[0];
    vertexCounts[i] = ring.length;
    totalVerts += ring.length;
  }
  const vertexData = new Float64Array(totalVerts * 2);
  let vOff = 0;
  for (let i = 0; i < n; i++) {
    const ring = localBuildings[i].footprint[0];
    for (let j = 0; j < ring.length; j++) {
      const pt = ring[j];
      // Support both {x, y} objects (post-projection JS convention) and
      // [x, y] tuples (test fixtures / Rust-style) — cheap check keeps
      // callers from having to normalize.
      if (Array.isArray(pt)) {
        vertexData[vOff++] = pt[0];
        vertexData[vOff++] = pt[1];
      } else {
        vertexData[vOff++] = pt.x;
        vertexData[vOff++] = pt.y;
      }
    }
  }
  return { heights, vertexCounts, vertexData };
}

/**
 * Break an ElevationGrid instance into the seven fields the Rust
 * deserializer expects. Zero-copy on `.data` — the Float32Array reference
 * is passed straight through; wasm-bindgen will memcpy into linear
 * memory at call time.
 *
 * Returns `null` if the grid is null — matches the "no terrain
 * available" fallback contract every compute function has.
 *
 * @param {import("./ElevationGrid").ElevationGrid | null} grid
 */
export function packTerrainGrid(grid) {
  if (!grid) return null;
  return {
    data: grid.data,
    cellsX: grid.cellsX,
    cellsY: grid.cellsY,
    northLat: grid.northLat,
    westLng: grid.westLng,
    latStepDeg: grid.latStepDeg,
    lngStepDeg: grid.lngStepDeg,
  };
}

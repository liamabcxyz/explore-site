// Convert the flat Float64Array outputs of the vantage-core wasm
// entries back into the FeatureCollection shape the rest of the app
// expects. The WASM side only carries per-cell / per-building
// numerics; polygon geometry and category strings live here so the
// wasm-bindgen boundary stays primitive-only.
//
// Kept in a JS module (not the worker) so tests and any future
// non-worker WASM caller can share it.

import { makeLocalProjector } from "@/lib/geo/toLocalMeters";

// Same table the wasm side encodes with — see scoring.rs's
// visibility_category comment. Order matters: index into this array
// must match the u32 emitted by Rust.
const GRID_CATEGORIES = ["blocked", "poor-angle", "partial", "good"];

// Rooftop adds "mixed" (=4) — see rooftop.rs's CATEGORY_MIXED constant.
const ROOFTOP_CATEGORIES = [...GRID_CATEGORIES, "mixed"];

/**
 * Convert `wasm.computeViewshed(...)` output into the FeatureCollection
 * shape `computeViewshed.js` produces. WASM emits only per-cell floats
 * (frac / score / category as f64) plus an avgCandidates header; the
 * polygon corners, sample lat/lng and category strings get built here
 * from the same shape params the WASM call used.
 *
 * @param {Float64Array | number[]} flat - WASM output
 * @param {{lat:number, lng:number}} launch - launch center for projection
 * @param {number} analysisRadius - meters
 * @param {number} radialSpacing - meters between rings
 * @param {number} angularSpacing - degrees between sectors
 */
export function unpackViewshedGrid(flat, launch, analysisRadius, radialSpacing, angularSpacing) {
  const projector = makeLocalProjector(launch.lat, launch.lng);
  const numRings = Math.floor(analysisRadius / radialSpacing);
  const numSectors = Math.round(360 / angularSpacing);
  const angleStep = (2 * Math.PI) / numSectors;
  const avgCandidates = flat[0];

  const features = new Array(numSectors * numRings);
  // Sector-outer / ring-inner traversal matches Rust's cell-index
  // ordering: cellIdx = s * numRings + r. Any change in Rust needs
  // the same change here.
  for (let s = 0; s < numSectors; s++) {
    const thetaInner = s * angleStep;
    const thetaOuter = thetaInner + angleStep;
    const midTheta = thetaInner + angleStep / 2;
    const cosMid = Math.cos(midTheta);
    const sinMid = Math.sin(midTheta);
    // Corners are the SAME 4 x/y points for every ring in this sector
    // when scaled by the ring's r_inner / r_outer — cache the unit
    // corners' cos/sin outside the inner loop.
    const cosInner = Math.cos(thetaInner);
    const sinInner = Math.sin(thetaInner);
    const cosOuter = Math.cos(thetaOuter);
    const sinOuter = Math.sin(thetaOuter);
    for (let r = 0; r < numRings; r++) {
      const cellIdx = s * numRings + r;
      const off = 1 + 3 * cellIdx;
      const frac = flat[off];
      const cellScore = flat[off + 1];
      const category = GRID_CATEGORIES[flat[off + 2] | 0];

      const rInner = r * radialSpacing;
      const rOuter = rInner + radialSpacing;
      const midR = (rInner + rOuter) / 2;
      const { lat: sampleLat, lng: sampleLng } = projector.toLatLng(
        midR * cosMid,
        midR * sinMid,
      );

      const corners = [
        [rInner * cosInner, rInner * sinInner],
        [rOuter * cosInner, rOuter * sinInner],
        [rOuter * cosOuter, rOuter * sinOuter],
        [rInner * cosOuter, rInner * sinOuter],
      ];
      const sectorRing = new Array(corners.length + 1);
      for (let i = 0; i < corners.length; i++) {
        const { lat, lng } = projector.toLatLng(corners[i][0], corners[i][1]);
        sectorRing[i] = [lng, lat];
      }
      sectorRing[corners.length] = sectorRing[0]; // close the ring

      features[cellIdx] = {
        type: "Feature",
        properties: { frac, score: cellScore, category, sampleLat, sampleLng },
        geometry: { type: "Polygon", coordinates: [sectorRing] },
      };
    }
  }

  return { type: "FeatureCollection", features, avgCandidates };
}

/**
 * Convert `wasm.computeRooftopLayer(...)` output into the
 * FeatureCollection shape `computeRooftopLayer.js` produces. Building
 * order in the flat output matches the input order — index `i` in the
 * output triples belongs to `buildings[i]`.
 *
 * The raw buildings array is needed here to re-attach `footprint` and
 * `buildingHeight` on each feature (WASM doesn't return either — the
 * caller already has both and can hand them straight through).
 *
 * @param {Float64Array | number[]} flat - WASM output
 * @param {Array<{footprint: Array<Array<[number,number]>>, height: number}>} buildings
 */
export function unpackRooftopLayer(flat, buildings) {
  const features = new Array(buildings.length);
  for (let i = 0; i < buildings.length; i++) {
    const off = 3 * i;
    const frac = flat[off];
    const cellScore = flat[off + 1];
    const category = ROOFTOP_CATEGORIES[flat[off + 2] | 0];
    features[i] = {
      type: "Feature",
      properties: {
        frac,
        score: cellScore,
        category,
        buildingHeight: buildings[i].height,
      },
      geometry: { type: "Polygon", coordinates: buildings[i].footprint },
    };
  }
  return { type: "FeatureCollection", features };
}

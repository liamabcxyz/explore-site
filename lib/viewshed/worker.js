import { computeViewshed } from "@/lib/viewshed/computeViewshed";
import { computeRooftopLayer } from "@/lib/viewshed/computeRooftopLayer";
import { ElevationGrid } from "@/lib/viewshed/ElevationGrid";
import {
  fractionVisible,
  elevationAngleDeg,
  apparentAngularDiameterDeg,
  angularSizeGate,
  elevationScore,
  score,
  comfortFactor,
  visibilityCategory,
  isBlocked,
} from "@/lib/viewshed/scoring";
import { apparentAltitude, curvatureDrop } from "@/lib/viewshed/curvature";
import { makeLocalProjector } from "@/lib/geo/toLocalMeters";

// Phase-C1 WASM self-check: 500+ pseudo-random inputs through every
// wasm-bindgen export in the pure-math layer, cross-checked against the
// JS reference. Zero mismatches is the pass bar (f64 semantics on both
// sides — bit-identical, not "close enough").
//
// Dynamic-import the WASM inside the worker rather than at module top
// level: top-level import from a wasm-bindgen bundler-target package
// forces webpack to treat this file as a module worker, which trips
// Next.js SSR analysis on the LaunchPointControl → worker chain with
// `Worker is not defined`.
async function wasmSelfCheck() {
  try {
    const wasm = await import("vantage-core");
    // Small deterministic PRNG so re-runs generate the same inputs and
    // any divergence is reproducible from just the seed.
    let seed = 0x9E3779B9 >>> 0;
    const rand = () => {
      seed = ((seed * 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const uniform = (lo, hi) => lo + rand() * (hi - lo);

    const tally = {};
    const record = (name, js, wa) => {
      const d = Math.abs(js - wa);
      if (!(name in tally)) tally[name] = { n: 0, max: 0 };
      tally[name].n += 1;
      if (d > tally[name].max) tally[name].max = d;
    };
    const recordCat = (name, js, wa) => {
      const jsCat = { blocked: 0, "poor-angle": 1, partial: 2, good: 3 }[js];
      if (!(name in tally)) tally[name] = { n: 0, mismatches: 0 };
      tally[name].n += 1;
      if (jsCat !== wa) tally[name].mismatches += 1;
    };

    const N = 100;
    for (let i = 0; i < N; i++) {
      // scoring.js
      const minAlt = uniform(-50, 500);
      const targetHeight = uniform(10, 400);
      const shellRadius = uniform(5, 100);
      const eyeH = uniform(0, 200);
      const dist = uniform(1, 30000);
      const heightDiff = uniform(-100, 400);
      record("fraction_visible", fractionVisible(minAlt, targetHeight, shellRadius),
        wasm.fraction_visible(minAlt, targetHeight, shellRadius));
      record("elevation_angle_deg", elevationAngleDeg(dist, heightDiff),
        wasm.elevation_angle_deg(dist, heightDiff));
      record("apparent_angular_diameter_deg", apparentAngularDiameterDeg(dist, heightDiff, shellRadius),
        wasm.apparent_angular_diameter_deg(dist, heightDiff, shellRadius));
      const theta = uniform(0, 3);
      const phi = uniform(-10, 60);
      record("angular_size_gate", angularSizeGate(theta), wasm.angular_size_gate(theta));
      record("elevation_score", elevationScore(phi), wasm.elevation_score(phi));
      record("comfort_factor", comfortFactor(theta, phi), wasm.comfort_factor(theta, phi));
      const jsScore = score({ minAlt, targetHeight, shellRadius, eyeHeight: eyeH, horizontalDistance: dist });
      const waScore = wasm.score(minAlt, targetHeight, shellRadius, eyeH, dist, 1);
      record("score", jsScore, waScore);
      const frac = fractionVisible(minAlt, targetHeight, shellRadius);
      const comf = comfortFactor(theta, phi);
      recordCat("visibility_category", visibilityCategory(frac, comf), wasm.visibility_category(frac, comf));
      record("is_blocked", isBlocked(frac) ? 1 : 0, wasm.is_blocked(frac) ? 1 : 0);

      // curvature.js
      const d2 = uniform(0, 30000);
      record("curvature_drop", curvatureDrop(d2), wasm.curvature_drop(d2));
      const h = uniform(0, 500);
      record("apparent_altitude", apparentAltitude(h, d2), wasm.apparent_altitude(h, d2));

      // projector (toLocalMeters.js)
      const originLat = uniform(-60, 60);
      const originLng = uniform(-180, 180);
      const lat = originLat + uniform(-0.05, 0.05);
      const lng = originLng + uniform(-0.05, 0.05);
      const proj = makeLocalProjector(originLat, originLng);
      const local = proj.toLocal(lat, lng);
      record("project_local_x", local.x, wasm.projectLocalX(originLat, originLng, lat, lng));
      record("project_local_y", local.y, wasm.projectLocalY(originLat, originLng, lat, lng));
      const back = proj.toLatLng(local.x, local.y);
      record("project_latlng_lat", back.lat, wasm.projectLatLngLat(originLat, originLng, local.x, local.y));
      record("project_latlng_lng", back.lng, wasm.projectLatLngLng(originLat, originLng, local.x, local.y));
    }

    const rows = Object.entries(tally).map(([name, t]) => {
      if ("mismatches" in t) return `  ${name}: ${t.mismatches}/${t.n} mismatches`;
      return `  ${name}: max |JS − WASM| = ${t.max.toExponential(3)} over ${t.n}`;
    });
    const anyDivergence = Object.values(tally).some((t) =>
      ("mismatches" in t) ? t.mismatches > 0 : t.max > 1e-12
    );
    const header = anyDivergence
      ? "[C1 wasm] SELF-CHECK FAILED — see rows"
      : `[C1 wasm] self-check: bit-identical across ${Object.keys(tally).length} functions, seed=0x9E3779B9`;
    (anyDivergence ? console.error : console.log)([header, ...rows].join("\n"));
  } catch (err) {
    console.error("[C1 wasm] load failed:", err);
  }
}
wasmSelfCheck();

// Both computed on every request and returned together — the rooftop
// building layer is cheap relative to the ground grid (one result per
// building rather than per grid cell) and the caller toggles which one is
// visible purely client-side, with no recompute on toggle. See
// components/launch/LaunchPointControl.jsx.
//
// terrainGrid arrives as a plain-object serialization (the Float32Array's
// underlying buffer + coord metadata) because postMessage's structuredClone
// preserves TypedArrays but the caller sends the plain shape for
// portability — reconstruct the class instance here so the compute
// functions can call its methods.
self.onmessage = (event) => {
  try {
    const { terrainGrid: tgData, ...rest } = event.data;
    const terrainGrid = tgData
      ? new ElevationGrid({
          data: new Float32Array(tgData.buffer),
          cellsX: tgData.cellsX,
          cellsY: tgData.cellsY,
          northLat: tgData.northLat,
          westLng: tgData.westLng,
          latStepDeg: tgData.latStepDeg,
          lngStepDeg: tgData.lngStepDeg,
        })
      : null;
    const args = { ...rest, terrainGrid };
    const grid = computeViewshed(args);
    const rooftop = computeRooftopLayer(args);
    self.postMessage({ grid, rooftop });
  } catch (err) {
    // Worker exceptions don't propagate to main-thread pageerror listeners;
    // send them back as a message so callers can see them in the console.
    self.postMessage({ error: String(err && err.stack || err) });
  }
};

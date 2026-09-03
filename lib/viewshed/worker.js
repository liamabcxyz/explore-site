import { computeViewshed } from "@/lib/viewshed/computeViewshed";
import { computeRooftopLayer } from "@/lib/viewshed/computeRooftopLayer";
import { ElevationGrid } from "@/lib/viewshed/ElevationGrid";
import { fractionVisible } from "@/lib/viewshed/scoring";

// Phase-A WASM smoke: dynamic-import the vantage-core WASM package inside
// the worker rather than at module top level. Top-level `import` from a
// wasm-bindgen bundler-target package forces webpack to treat this file as
// a module worker, which then trips SSR analysis in Next.js
// (MapView.jsx → LaunchPointControl.jsx → this worker chain).
// Dynamic import defers the wasm load to Worker runtime, keeps the
// worker as a classic worker at bundle time, and prints the JS↔WASM diff
// so a broken build path fails loud rather than silent.
async function phaseAWasmSelfCheck() {
  try {
    const { fraction_visible: wasmFractionVisible } = await import("vantage-core");
    const samples = [
      [100, 200, 50],   // fully visible (k=-2)
      [300, 200, 50],   // fully blocked (k=+2)
      [200, 200, 50],   // half (k=0)
      [225, 200, 50],   // k=0.5 — divergence-from-linear canonical case
      [180, 200, 40],   // k=-0.5
    ];
    let maxAbsDiff = 0;
    for (const [ma, th, sr] of samples) {
      const js = fractionVisible(ma, th, sr);
      const wa = wasmFractionVisible(ma, th, sr);
      const d = Math.abs(js - wa);
      if (d > maxAbsDiff) maxAbsDiff = d;
    }
    console.log(`[phase-A wasm] fraction_visible self-check: max |JS - WASM| = ${maxAbsDiff.toExponential(3)} over ${samples.length} samples`);
  } catch (err) {
    console.error("[phase-A wasm] load failed:", err);
  }
}
phaseAWasmSelfCheck();

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

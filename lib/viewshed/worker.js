import { computeViewshed } from "@/lib/viewshed/computeViewshed";
import { computeRooftopLayer } from "@/lib/viewshed/computeRooftopLayer";
import { computeSightlineProfile } from "@/lib/viewshed/computeProfile";
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
import { intersectSegmentBuilding } from "@/lib/viewshed/sightline";
import { ElevationGrid as JsElevationGrid } from "@/lib/viewshed/ElevationGrid";
import { packBuildings, packTerrainGrid } from "@/lib/viewshed/wasmMarshaling";

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

      // C2: sightline (intersect one square building)
      // Random 2×w × 2×h axis-aligned building somewhere in the ray corridor.
      const bcx = uniform(20, 400);
      const bcy = uniform(-10, 10);
      const bw = uniform(3, 30);
      const bh = uniform(3, 30);
      const bldgHeight = uniform(10, 200);
      const ring = [
        [bcx - bw, bcy - bh], [bcx + bw, bcy - bh],
        [bcx + bw, bcy + bh], [bcx - bw, bcy + bh],
        [bcx - bw, bcy - bh],
      ];
      const flatRing = new Float64Array(ring.length * 2);
      for (let i = 0; i < ring.length; i++) {
        flatRing[i * 2] = ring[i][0]; flatRing[i * 2 + 1] = ring[i][1];
      }
      const obs = { x: 0, y: 0, z: uniform(1, 5) };
      const tgt = { x: uniform(200, 800), y: 0, z: uniform(50, 400) };
      const jsHit = intersectSegmentBuilding(obs, tgt, {
        footprint: [ring.map(([x, y]) => ({ x, y }))],
        height: bldgHeight,
      });
      const waHitArr = wasm.intersectSegmentBuildingFlat(
        obs.x, obs.y, obs.z, tgt.x, tgt.y, tgt.z, flatRing, bldgHeight
      );
      const jsTE = jsHit?.tEntry ?? NaN;
      const jsTX = jsHit?.tExit ?? NaN;
      const jsRQ = jsHit?.req ?? NaN;
      const eq = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) < 1e-9;
      const mismatch = !eq(jsTE, waHitArr[0]) || !eq(jsTX, waHitArr[1]) || !eq(jsRQ, waHitArr[2]);
      if (!("intersect_segment_building" in tally)) tally.intersect_segment_building = { n: 0, mismatches: 0 };
      tally.intersect_segment_building.n += 1;
      if (mismatch) tally.intersect_segment_building.mismatches += 1;

      // C2: bilinear on ElevationGrid
      const gN = 4; // 4×4 grid
      const gridData = new Float32Array(gN * gN);
      for (let i = 0; i < gridData.length; i++) gridData[i] = uniform(-10, 500);
      const gNorth = uniform(-60, 60);
      const gWest = uniform(-180, 180);
      const gLatStep = -0.001;
      const gLngStep = 0.001;
      const jsGrid = new JsElevationGrid({
        data: gridData, cellsX: gN, cellsY: gN,
        northLat: gNorth, westLng: gWest, latStepDeg: gLatStep, lngStepDeg: gLngStep,
      });
      // Query point inside coverage (rand inside the 3-step-wide covered box)
      const qLat = gNorth + gLatStep * uniform(0, gN - 1);
      const qLng = gWest + gLngStep * uniform(0, gN - 1);
      const jsElev = jsGrid.getElevation(qLng, qLat) ?? NaN;
      const waElev = wasm.elevationBilinear(gridData, gN, gN, gNorth, gWest, gLatStep, gLngStep, qLng, qLat);
      record("elevation_bilinear", jsElev, waElev);
    }

    // C3: marshaling round-trip. Build a batch of random buildings +
    // one terrain grid, pack via wasmMarshaling, ship through WASM, and
    // check the reductions Rust computes over the deserialized data
    // match what JS computes from the same source.
    const nB = 40;
    const localBuildings = [];
    let jsTotalVerts = 0, jsSumH = 0;
    let jsMinX = Infinity, jsMaxX = -Infinity, jsMinY = Infinity, jsMaxY = -Infinity;
    for (let i = 0; i < nB; i++) {
      const cx = uniform(-500, 500);
      const cy = uniform(-500, 500);
      const rw = uniform(3, 30);
      const rh = uniform(3, 30);
      const height = uniform(5, 200);
      const ring = [
        { x: cx - rw, y: cy - rh }, { x: cx + rw, y: cy - rh },
        { x: cx + rw, y: cy + rh }, { x: cx - rw, y: cy + rh },
        { x: cx - rw, y: cy - rh },
      ];
      localBuildings.push({ footprint: [ring], height });
      jsSumH += height;
      jsTotalVerts += ring.length;
      for (const p of ring) {
        if (p.x < jsMinX) jsMinX = p.x;
        if (p.x > jsMaxX) jsMaxX = p.x;
        if (p.y < jsMinY) jsMinY = p.y;
        if (p.y > jsMaxY) jsMaxY = p.y;
      }
    }
    const packedB = packBuildings(localBuildings);
    const bStats = wasm.roundtripBuildings(packedB.heights, packedB.vertexCounts, packedB.vertexData);
    // f32 round trip on heights loses precision; use loose tolerance.
    const bldgOk =
      bStats[0] === nB &&
      bStats[1] === jsTotalVerts &&
      Math.abs(bStats[2] - jsSumH) < 1e-3 &&
      Math.abs(bStats[3] - jsMinX) < 1e-9 &&
      Math.abs(bStats[4] - jsMaxX) < 1e-9 &&
      Math.abs(bStats[5] - jsMinY) < 1e-9 &&
      Math.abs(bStats[6] - jsMaxY) < 1e-9;
    if (!("marshaling_buildings" in tally)) tally.marshaling_buildings = { n: 0, mismatches: 0 };
    tally.marshaling_buildings.n += 1;
    if (!bldgOk) tally.marshaling_buildings.mismatches += 1;

    // Terrain marshaling: build a random 8×8 grid, pack, ship, diff sum.
    const tCells = 8;
    const tData = new Float32Array(tCells * tCells);
    for (let i = 0; i < tData.length; i++) tData[i] = uniform(-10, 500);
    const jsSum = Array.from(tData).reduce((a, b) => a + b, 0);
    const packedT = packTerrainGrid(new JsElevationGrid({
      data: tData, cellsX: tCells, cellsY: tCells,
      northLat: 40.71, westLng: -74.0, latStepDeg: -0.001, lngStepDeg: 0.001,
    }));
    const tStats = wasm.roundtripTerrain(
      packedT.data, packedT.cellsX, packedT.cellsY,
      packedT.northLat, packedT.westLng, packedT.latStepDeg, packedT.lngStepDeg
    );
    const terrainOk =
      tStats[0] === tCells &&
      tStats[1] === tCells &&
      Math.abs(tStats[4] - jsSum) < 1e-2; // f32 sum, tolerable
    if (!("marshaling_terrain" in tally)) tally.marshaling_terrain = { n: 0, mismatches: 0 };
    tally.marshaling_terrain.n += 1;
    if (!terrainOk) tally.marshaling_terrain.mismatches += 1;

    // C4: end-to-end computeViewshed parity. A handful of small
    // randomized scenes (few dozen buildings, small analysis radius,
    // sometimes a terrain grid) — run through both JS `computeViewshed`
    // and the new Rust `wasm.computeViewshed`, then cross-check every
    // cell's frac/score/category. Bit-parity because both sides use f64
    // math end-to-end; the packing conversion between f32 heights and
    // f64 uses a straight cast which round-trips exactly for typical
    // building-height values.
    const catCode = { blocked: 0, "poor-angle": 1, partial: 2, good: 3 };
    if (!("computeViewshed_avg" in tally)) tally.computeViewshed_avg = { n: 0, max: 0 };
    if (!("computeViewshed_frac" in tally)) tally.computeViewshed_frac = { n: 0, max: 0 };
    if (!("computeViewshed_score" in tally)) tally.computeViewshed_score = { n: 0, max: 0 };
    if (!("computeViewshed_category" in tally)) tally.computeViewshed_category = { n: 0, mismatches: 0 };
    // A few different scene shapes: with/without terrain, dense/sparse.
    const scenes = [
      { withTerrain: false, nBldg: 20, analysisRadius: 300, radialSpacing: 20, angularSpacing: 6 },
      { withTerrain: false, nBldg: 40, analysisRadius: 500, radialSpacing: 25, angularSpacing: 12 },
      { withTerrain: true,  nBldg: 30, analysisRadius: 400, radialSpacing: 20, angularSpacing: 6 },
      { withTerrain: true,  nBldg: 50, analysisRadius: 600, radialSpacing: 25, angularSpacing: 10 },
    ];
    for (const scene of scenes) {
      const launchLat = uniform(35, 45);
      const launchLng = uniform(-125, -70);
      const targetHeight = uniform(100, 300);
      const shellRadius = uniform(20, 80);
      // Raw normalized buildings: footprints as [lng, lat] pairs,
      // .height meters-above-base. matches JS computeViewshed's input.
      const rawBuildings = [];
      // Local projector, used only to place buildings in a realistic
      // spot relative to the launch point.
      const sceneProj = makeLocalProjector(launchLat, launchLng);
      for (let i = 0; i < scene.nBldg; i++) {
        const cx = uniform(-scene.analysisRadius, scene.analysisRadius);
        const cy = uniform(-scene.analysisRadius, scene.analysisRadius);
        const w = uniform(5, 25);
        const h = uniform(5, 25);
        const heightM = uniform(10, 150);
        const corners = [
          [cx - w, cy - h], [cx + w, cy - h],
          [cx + w, cy + h], [cx - w, cy + h],
          [cx - w, cy - h],
        ].map(([x, y]) => {
          const { lat, lng } = sceneProj.toLatLng(x, y);
          return [lng, lat];
        });
        rawBuildings.push({ footprint: [corners], base: 0, height: heightM });
      }
      // Optional terrain: 8×8 grid over roughly ±1 km around the launch.
      let terrainGrid = null;
      if (scene.withTerrain) {
        const nw = sceneProj.toLatLng(-1000, 1000);
        const se = sceneProj.toLatLng(1000, -1000);
        const gCells = 8;
        const gData = new Float32Array(gCells * gCells);
        for (let i = 0; i < gData.length; i++) gData[i] = uniform(-5, 60);
        terrainGrid = new JsElevationGrid({
          data: gData, cellsX: gCells, cellsY: gCells,
          northLat: nw.lat, westLng: nw.lng,
          latStepDeg: (se.lat - nw.lat) / (gCells - 1),
          lngStepDeg: (se.lng - nw.lng) / (gCells - 1),
        });
      }
      // Pack for WASM first so we can build a reference JS input that
      // reads heights from the same f32 storage — otherwise the JS
      // reference runs at f64 precision while WASM sees f32-rounded
      // heights and every cell's frac drifts by ~1e-7. The f32 pack
      // is what real production callers will use; making the parity
      // check honest means both sides ingest the same bytes.
      const packed = packBuildings(
        rawBuildings.map((b) => ({ footprint: b.footprint, height: b.height }))
      );
      const referenceBuildings = rawBuildings.map((b, i) => ({
        footprint: b.footprint,
        base: b.base,
        // Float32Array element reads widen to f64 — the exact value
        // WASM's `heights[idx] as f64` will produce on the Rust side.
        height: packed.heights[i],
      }));
      const args = {
        launch: { lat: launchLat, lng: launchLng },
        targetHeight, shellRadius,
        analysisRadius: scene.analysisRadius,
        radialSpacing: scene.radialSpacing,
        angularSpacing: scene.angularSpacing,
        buildings: referenceBuildings,
        terrainGrid,
      };
      // Reference path (canonical JS) on the same bytes WASM will see.
      const jsOut = computeViewshed(args);
      const packedTG = terrainGrid ? packTerrainGrid(terrainGrid) : null;
      const flat = wasm.computeViewshed(
        launchLat, launchLng,
        targetHeight, shellRadius,
        scene.analysisRadius, scene.radialSpacing, scene.angularSpacing,
        packed.heights, packed.vertexCounts, packed.vertexData,
        packedTG ? 1 : 0,
        packedTG ? packedTG.data : new Float32Array(0),
        packedTG ? packedTG.cellsX : 0,
        packedTG ? packedTG.cellsY : 0,
        packedTG ? packedTG.northLat : 0,
        packedTG ? packedTG.westLng : 0,
        packedTG ? packedTG.latStepDeg : 0,
        packedTG ? packedTG.lngStepDeg : 0,
      );
      // Header + cells.
      const dAvg = Math.abs(flat[0] - jsOut.avgCandidates);
      tally.computeViewshed_avg.n += 1;
      if (dAvg > tally.computeViewshed_avg.max) tally.computeViewshed_avg.max = dAvg;
      for (let i = 0; i < jsOut.features.length; i++) {
        const p = jsOut.features[i].properties;
        const off = 1 + 3 * i;
        const dFrac = Math.abs(flat[off] - p.frac);
        const dScore = Math.abs(flat[off + 1] - p.score);
        tally.computeViewshed_frac.n += 1;
        if (dFrac > tally.computeViewshed_frac.max) tally.computeViewshed_frac.max = dFrac;
        tally.computeViewshed_score.n += 1;
        if (dScore > tally.computeViewshed_score.max) tally.computeViewshed_score.max = dScore;
        tally.computeViewshed_category.n += 1;
        if (flat[off + 2] !== catCode[p.category]) {
          tally.computeViewshed_category.mismatches += 1;
        }
      }

      // C5a: rooftop layer parity. Same buildings, same terrain; per-
      // building [frac, score, category] triples with `mixed` (=4) added
      // to the category range. computeRooftopLayer takes fewer args than
      // computeViewshed (no analysis radius, no ring/sector spacing) —
      // it's per-building, not per-grid-cell.
      const jsRoof = computeRooftopLayer(args);
      const roofFlat = wasm.computeRooftopLayer(
        launchLat, launchLng,
        targetHeight, shellRadius,
        packed.heights, packed.vertexCounts, packed.vertexData,
        packedTG ? 1 : 0,
        packedTG ? packedTG.data : new Float32Array(0),
        packedTG ? packedTG.cellsX : 0,
        packedTG ? packedTG.cellsY : 0,
        packedTG ? packedTG.northLat : 0,
        packedTG ? packedTG.westLng : 0,
        packedTG ? packedTG.latStepDeg : 0,
        packedTG ? packedTG.lngStepDeg : 0,
      );
      const roofCatCode = { ...catCode, mixed: 4 };
      if (!("rooftop_frac" in tally)) tally.rooftop_frac = { n: 0, max: 0 };
      if (!("rooftop_score" in tally)) tally.rooftop_score = { n: 0, max: 0 };
      if (!("rooftop_category" in tally)) tally.rooftop_category = { n: 0, mismatches: 0 };
      for (let i = 0; i < jsRoof.features.length; i++) {
        const p = jsRoof.features[i].properties;
        const off = 3 * i;
        const dFrac = Math.abs(roofFlat[off] - p.frac);
        const dScore = Math.abs(roofFlat[off + 1] - p.score);
        tally.rooftop_frac.n += 1;
        if (dFrac > tally.rooftop_frac.max) tally.rooftop_frac.max = dFrac;
        tally.rooftop_score.n += 1;
        if (dScore > tally.rooftop_score.max) tally.rooftop_score.max = dScore;
        tally.rooftop_category.n += 1;
        if (roofFlat[off + 2] !== roofCatCode[p.category]) {
          tally.rooftop_category.mismatches += 1;
        }
      }

      // C5b: sightline profile parity. Observer somewhere off-launch,
      // request the flat "one sightline breakdown" output and diff the
      // header scalars + each hit's (distance, req) + each terrain
      // sample. Building metadata (name, confidence, footprint) isn't
      // in the WASM output — those get re-attached by index on the JS
      // side — so parity here only checks numerics.
      const obsOffsetX = uniform(200, scene.analysisRadius - 100);
      const obsOffsetY = uniform(-scene.analysisRadius / 2, scene.analysisRadius / 2);
      const obsLatLng = sceneProj.toLatLng(obsOffsetX, obsOffsetY);
      const jsProf = computeSightlineProfile({
        launch: { lat: launchLat, lng: launchLng },
        observer: { lat: obsLatLng.lat, lng: obsLatLng.lng },
        targetHeight, shellRadius,
        buildings: referenceBuildings,
        terrainGrid,
      });
      const profFlat = wasm.computeSightlineProfile(
        launchLat, launchLng,
        obsLatLng.lat, obsLatLng.lng,
        targetHeight, shellRadius,
        /* observer_height (JS default EYE_HEIGHT = 1.6) */ 1.6,
        packed.heights, packed.vertexCounts, packed.vertexData,
        packedTG ? 1 : 0,
        packedTG ? packedTG.data : new Float32Array(0),
        packedTG ? packedTG.cellsX : 0,
        packedTG ? packedTG.cellsY : 0,
        packedTG ? packedTG.northLat : 0,
        packedTG ? packedTG.westLng : 0,
        packedTG ? packedTG.latStepDeg : 0,
        packedTG ? packedTG.lngStepDeg : 0,
      );
      if (!("profile_header" in tally)) tally.profile_header = { n: 0, max: 0 };
      if (!("profile_hits" in tally)) tally.profile_hits = { n: 0, mismatches: 0 };
      if (!("profile_terrain" in tally)) tally.profile_terrain = { n: 0, max: 0 };
      // Header (14 scalars) — diff against JS reference field by field.
      // Skip min_alt when JS returned -Infinity (it survives the pack).
      const headerFields = [
        ["total_distance", jsProf.totalDistance, profFlat[0]],
        ["launch_elev", jsProf.launchElev, profFlat[1]],
        ["observer_ground_elev", jsProf.observerGroundElev, profFlat[2]],
        ["observer_abs_alt", jsProf.observerAbsAlt, profFlat[3]],
        ["target_abs_alt", jsProf.targetAbsAlt, profFlat[4]],
        ["target_apparent_alt", jsProf.targetApparentAlt, profFlat[5]],
        ["min_alt", jsProf.minAlt, profFlat[6]],
        ["frac", jsProf.frac, profFlat[7]],
        ["theta", jsProf.theta, profFlat[8]],
        ["phi", jsProf.phi, profFlat[9]],
        ["score", jsProf.score, profFlat[10]],
      ];
      for (const [_, js, wa] of headerFields) {
        if (js === -Infinity && wa === -Infinity) continue;
        const d = Math.abs(js - wa);
        tally.profile_header.n += 1;
        if (d > tally.profile_header.max) tally.profile_header.max = d;
      }
      // hits — count parity + distance/req parity by JS-side index
      const jsNumHits = jsProf.hits.length;
      const waNumHits = profFlat[12];
      tally.profile_hits.n += 1;
      if (jsNumHits !== waNumHits) tally.profile_hits.mismatches += 1;
      // Terrain: sample count + per-sample elevation parity
      const jsNumT = jsProf.terrainProfile.length;
      const waNumT = profFlat[13];
      if (jsNumT === waNumT) {
        const tOff = 14 + 4 * waNumHits;
        for (let i = 0; i < jsNumT; i++) {
          const jsE = jsProf.terrainProfile[i].elevation;
          const waE = profFlat[tOff + 2 * i + 1];
          const d = Math.abs(jsE - waE);
          tally.profile_terrain.n += 1;
          if (d > tally.profile_terrain.max) tally.profile_terrain.max = d;
        }
      } else {
        // Count mismatch — record as a header divergence so it shows
        // in the output.
        tally.profile_header.max = Math.max(tally.profile_header.max, 1.0);
        tally.profile_header.n += 1;
      }
    }

    const rows = Object.entries(tally).map(([name, t]) => {
      if ("mismatches" in t) return `  ${name}: ${t.mismatches}/${t.n} mismatches`;
      return `  ${name}: max |JS − WASM| = ${t.max.toExponential(3)} over ${t.n}`;
    });
    const anyDivergence = Object.values(tally).some((t) =>
      ("mismatches" in t) ? t.mismatches > 0 : t.max > 1e-12
    );
    const header = anyDivergence
      ? "[C5 wasm] SELF-CHECK FAILED — see rows"
      : `[C5 wasm] self-check: bit-identical across ${Object.keys(tally).length} checks, seed=0x9E3779B9`;
    (anyDivergence ? console.error : console.log)([header, ...rows].join("\n"));
  } catch (err) {
    console.error("[C5 wasm] load failed:", err);
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
// Compute-backend dispatch. `impl` arrives from LaunchPointControl
// (URL param `?impl=js|wasm|both`, default `js`) so switching backends
// is a URL change + drop-a-new-pin, no reload.
//
// Post-C5: Rust ports of `compute_viewshed` and
// `compute_rooftop_layer` both exist and match JS bit-for-bit (see
// the self-check above). `runWasm` today: (a) times both real WASM
// entries on the same args, (b) returns the JS result so the
// downstream render still sees the GeoJSON shape. The point of this
// half-wired state is honest perf measurement on real production
// input BEFORE investing in the JS-side FeatureCollection
// reconstruction that C6 needs to actually swap the render path.
//
// `impl=wasm` and `impl=both` diff the WASM outputs against JS cell-
// by-cell / building-by-building, so any regression from WASM code
// changes shows up as a divergence line rather than silent drift.

let wasmModulePromise = null;
function loadWasm() {
  if (wasmModulePromise === null) wasmModulePromise = import("vantage-core");
  return wasmModulePromise;
}

/**
 * Time WASM `computeViewshed` + `computeRooftopLayer` on the same args
 * JS just ran on, and diff every cell / building against the JS result.
 * Returns the collected perf/diff summary. Packing runs once — both
 * WASM entries reuse the same packed building/terrain arrays.
 *
 * IMPORTANT: pass in `jsGrid` and `jsRooftop` (the JS FeatureCollections)
 * — cellular `frac/score/category` live in properties there and can be
 * diffed directly against the flat WASM Float64Arrays without asking
 * WASM to reconstruct GeoJSON on its side.
 */
async function runWasmCompute(args, jsGrid, jsRooftop) {
  const wasm = await loadWasm();

  const packStart = performance.now();
  const packed = packBuildings(args.buildings);
  const packedTG = args.terrainGrid ? packTerrainGrid(args.terrainGrid) : null;
  const packMs = performance.now() - packStart;

  // computeViewshed (ground grid)
  const gridStart = performance.now();
  const gridFlat = wasm.computeViewshed(
    args.launch.lat, args.launch.lng,
    args.targetHeight, args.shellRadius,
    args.analysisRadius,
    args.radialSpacing ?? 20,
    args.angularSpacing ?? 6,
    packed.heights, packed.vertexCounts, packed.vertexData,
    packedTG ? 1 : 0,
    packedTG ? packedTG.data : new Float32Array(0),
    packedTG ? packedTG.cellsX : 0,
    packedTG ? packedTG.cellsY : 0,
    packedTG ? packedTG.northLat : 0,
    packedTG ? packedTG.westLng : 0,
    packedTG ? packedTG.latStepDeg : 0,
    packedTG ? packedTG.lngStepDeg : 0,
  );
  const gridComputeMs = performance.now() - gridStart;

  // computeRooftopLayer
  const roofStart = performance.now();
  const roofFlat = wasm.computeRooftopLayer(
    args.launch.lat, args.launch.lng,
    args.targetHeight, args.shellRadius,
    packed.heights, packed.vertexCounts, packed.vertexData,
    packedTG ? 1 : 0,
    packedTG ? packedTG.data : new Float32Array(0),
    packedTG ? packedTG.cellsX : 0,
    packedTG ? packedTG.cellsY : 0,
    packedTG ? packedTG.northLat : 0,
    packedTG ? packedTG.westLng : 0,
    packedTG ? packedTG.latStepDeg : 0,
    packedTG ? packedTG.lngStepDeg : 0,
  );
  const roofComputeMs = performance.now() - roofStart;

  // Grid diff
  const catCode = { blocked: 0, "poor-angle": 1, partial: 2, good: 3 };
  let gMaxFrac = 0, gMaxScore = 0, gCat = 0;
  for (let i = 0; i < jsGrid.features.length; i++) {
    const p = jsGrid.features[i].properties;
    const off = 1 + 3 * i;
    const dF = Math.abs(gridFlat[off] - p.frac);
    const dS = Math.abs(gridFlat[off + 1] - p.score);
    if (dF > gMaxFrac) gMaxFrac = dF;
    if (dS > gMaxScore) gMaxScore = dS;
    if (gridFlat[off + 2] !== catCode[p.category]) gCat += 1;
  }
  const gridAvgDiff = Math.abs(gridFlat[0] - jsGrid.avgCandidates);

  // Rooftop diff
  const roofCatCode = { ...catCode, mixed: 4 };
  let rMaxFrac = 0, rMaxScore = 0, rCat = 0;
  for (let i = 0; i < jsRooftop.features.length; i++) {
    const p = jsRooftop.features[i].properties;
    const off = 3 * i;
    const dF = Math.abs(roofFlat[off] - p.frac);
    const dS = Math.abs(roofFlat[off + 1] - p.score);
    if (dF > rMaxFrac) rMaxFrac = dF;
    if (dS > rMaxScore) rMaxScore = dS;
    if (roofFlat[off + 2] !== roofCatCode[p.category]) rCat += 1;
  }

  return {
    packMs,
    grid: {
      computeMs: gridComputeMs, cells: jsGrid.features.length,
      maxFrac: gMaxFrac, maxScore: gMaxScore, catMismatches: gCat, avgDiff: gridAvgDiff,
    },
    roof: {
      computeMs: roofComputeMs, buildings: jsRooftop.features.length,
      maxFrac: rMaxFrac, maxScore: rMaxScore, catMismatches: rCat,
    },
  };
}

self.onmessage = (event) => {
  try {
    const { terrainGrid: tgData, impl: implRaw, ...rest } = event.data;
    const impl = (implRaw === "wasm" || implRaw === "both") ? implRaw : "js";
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

    // JS path — canonical today. Time it so we can compare against
    // WASM apples-to-apples.
    const runJs = () => {
      const gridStart = performance.now();
      const grid = computeViewshed(args);
      const gridMs = performance.now() - gridStart;
      const rooftopStart = performance.now();
      const rooftop = computeRooftopLayer(args);
      const rooftopMs = performance.now() - rooftopStart;
      return { grid, rooftop, gridMs, rooftopMs };
    };

    const js = runJs();
    // Ship JS result to the main thread immediately so the UI isn't
    // blocked on the WASM measurement (which is fire-and-forget: the
    // perf log is a side-channel via console).
    self.postMessage({ grid: js.grid, rooftop: js.rooftop, impl });

    if (impl !== "js") {
      // Fire-and-forget WASM measurement — main thread already has
      // its result; this just prints a perf line to the console.
      runWasmCompute(args, js.grid, js.rooftop)
        .then((w) => {
          if (w == null) return;
          // Threshold: `visible impact`-shaped, not "bit-identical."
          // JS reads .height as f64 while WASM sees f32-packed heights
          // (see the C3 marshaling contract), so ~1e-7 divergence is
          // expected on real Overture buildings and pixel-invisible.
          // Cell/building category flips ARE user-visible — strict there.
          const withinTol = (x) =>
            x.catMismatches === 0 && x.maxFrac < 1e-5 && x.maxScore < 1e-5;
          const gridOk = withinTol(w.grid) && w.grid.avgDiff < 1e-6;
          const roofOk = withinTol(w.roof);
          const parity =
            gridOk && roofOk
              ? `parity ok (grid frac Δ=${w.grid.maxFrac.toExponential(2)}, roof frac Δ=${w.roof.maxFrac.toExponential(2)})`
              : `DIVERGENT (grid cat=${w.grid.catMismatches} frac=${w.grid.maxFrac.toExponential(2)}; roof cat=${w.roof.catMismatches} frac=${w.roof.maxFrac.toExponential(2)})`;
          const gridSpeedup = w.grid.computeMs > 0 ? js.gridMs / w.grid.computeMs : Infinity;
          const roofSpeedup = w.roof.computeMs > 0 ? js.rooftopMs / w.roof.computeMs : Infinity;
          const bldgCount = (args.buildings || []).length;
          const totalJs = js.gridMs + js.rooftopMs;
          const totalWasm = w.grid.computeMs + w.roof.computeMs + w.packMs;
          const totalSpeedup = totalWasm > 0 ? totalJs / totalWasm : Infinity;
          console.log(
            `[viewshed perf] ${bldgCount} bldgs, ${w.grid.cells} cells | ` +
              `JS grid ${js.gridMs.toFixed(1)}ms + rooftop ${js.rooftopMs.toFixed(1)}ms | ` +
              `WASM grid ${w.grid.computeMs.toFixed(1)}ms + rooftop ${w.roof.computeMs.toFixed(1)}ms (pack ${w.packMs.toFixed(1)}ms) | ` +
              `grid ${gridSpeedup.toFixed(2)}x, rooftop ${roofSpeedup.toFixed(2)}x, total ${totalSpeedup.toFixed(2)}x | ${parity}`
          );
        })
        .catch((err) => console.warn("[viewshed perf] WASM comparison failed:", err));
    }
  } catch (err) {
    // Worker exceptions don't propagate to main-thread pageerror listeners;
    // send them back as a message so callers can see them in the console.
    self.postMessage({ error: String(err && err.stack || err) });
  }
};

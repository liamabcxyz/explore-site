import { computeViewshed } from "@/lib/viewshed/computeViewshed";
import { computeSightlineProfile } from "@/lib/viewshed/computeProfile";
import { ElevationGrid } from "@/lib/viewshed/ElevationGrid";
import { makeLocalProjector } from "@/lib/geo/toLocalMeters";

const launch = { lat: 37.7925, lng: -122.397 };
const projector = makeLocalProjector(launch.lat, launch.lng);

function squareAt(xMin, xMax, yMin, yMax, height) {
  const corners = [
    [xMin, yMin], [xMax, yMin], [xMax, yMax], [xMin, yMax], [xMin, yMin],
  ].map(([x, y]) => {
    const { lat, lng } = projector.toLatLng(x, y);
    return [lng, lat];
  });
  return { footprint: [corners], base: 0, height };
}

// Build a uniform-elevation grid covering roughly ±200m around the launch
// point. Simplest possible ElevationGrid — every pixel returns `constMeters`.
function uniformTerrainGrid(constMeters, cellsX = 4, cellsY = 4) {
  const nw = projector.toLatLng(-200, 200);
  const se = projector.toLatLng(200, -200);
  const data = new Float32Array(cellsX * cellsY);
  data.fill(constMeters);
  return new ElevationGrid({
    data,
    cellsX,
    cellsY,
    northLat: nw.lat,
    westLng: nw.lng,
    latStepDeg: (se.lat - nw.lat) / (cellsY - 1),
    lngStepDeg: (se.lng - nw.lng) / (cellsX - 1),
  });
}

describe("computeViewshed with terrain — pre-existing-behavior guarantees", () => {
  it("produces byte-identical output when terrainGrid is null vs. omitted", () => {
    // Regression guard: the null default arg must not perturb the math.
    // If it did, the 700+ pre-Phase-3 fixtures would be silently off.
    const buildings = [squareAt(-15, -5, -5, 5, 200)];
    const args = {
      launch, targetHeight: 50, shellRadius: 10, analysisRadius: 50,
      radialSpacing: 50, angularSpacing: 120, buildings,
    };
    const omitted = computeViewshed(args);
    const nulled = computeViewshed({ ...args, terrainGrid: null });
    expect(nulled.features).toEqual(omitted.features);
  });

  it("produces byte-identical output when terrainGrid is uniformly zero (ElevationGrid.flat)", () => {
    // The Phase 3 test-migration story (实施方案 §6): pre-terrain fixtures
    // pass through with numerically identical results when terrainGrid is
    // flat. Verified here directly.
    const buildings = [squareAt(-15, -5, -5, 5, 200)];
    const nw = projector.toLatLng(-200, 200);
    const se = projector.toLatLng(200, -200);
    const flat = ElevationGrid.flat({
      westLng: nw.lng, northLat: nw.lat, eastLng: se.lng, southLat: se.lat,
    });
    const args = {
      launch, targetHeight: 50, shellRadius: 10, analysisRadius: 50,
      radialSpacing: 50, angularSpacing: 120, buildings,
    };
    const withoutTerrain = computeViewshed(args);
    const withFlat = computeViewshed({ ...args, terrainGrid: flat });
    expect(withFlat.features).toEqual(withoutTerrain.features);
  });

  it("produces identical output when terrainGrid is uniformly elevated (all heights lift together)", () => {
    // Invariant: if launch, observer, and all buildings sit on the SAME
    // absolute elevation, the sightline math sees exactly the same relative
    // geometry as z=0 everywhere. This is a physics check — if it fails,
    // the terrain integration accidentally lifted only some but not all
    // heights (a silent asymmetry bug).
    const buildings = [squareAt(-15, -5, -5, 5, 200)];
    const args = {
      launch, targetHeight: 50, shellRadius: 10, analysisRadius: 50,
      radialSpacing: 50, angularSpacing: 120, buildings,
    };
    const flat = computeViewshed(args);
    const elevated = computeViewshed({ ...args, terrainGrid: uniformTerrainGrid(300) });
    expect(elevated.features).toEqual(flat.features);
  });
});

describe("computeViewshed with terrain — new behavior", () => {
  it("lets an elevated observer see over a building that would otherwise block them", () => {
    // Setup:
    // - Launch at origin, target burst at 80m ASL.
    // - Building at x∈[-40,-10], y∈[-20,20], 60m tall.
    // - Observer at (-100, 0) = midR sample point of the west-facing sector
    //   (analysisRadius=200 with radialSpacing=200, so midR=100;
    //   angularSpacing=120 puts sector index 1 at bearing 180°).
    //
    // Without terrain: sightline from eye 1.6m up to burst 80m over
    // 100m horizontal. At tEntry=0.6 (west edge of building), line alt =
    // 48.6m, building roof at 60m → line is below, blocked. Required
    // clearance req = 98.9m, frac = 0.
    //
    // With terrain that raises ONLY observer's local area (grid covers
    // just a small patch around x=-100) to 200m: getElevation returns
    // 200m at observer, null (→ treated as 0) at the building centroid
    // and launch point since they're outside the grid's coverage. Result:
    // observer.z = 201.6, target.z = 80, building_absroof = 60. Line
    // slopes DOWN from 201.6 to 80; at tEntry=0.6 line is at 188.6m,
    // building at 60m doesn't block. frac becomes 1 (category may land
    // in "poor-angle" because looking downward gives negative elevation
    // angle — that's a scoring.js concern, not a terrain-integration
    // one; the frac transition is the physics signal we care about here).
    //
    // Real-world terrain covers everywhere, but this synthetic partial-
    // coverage grid is the cleanest way to isolate the observer-lifted
    // behavior — falling back to 0m at uncovered points is exactly the
    // documented downgrade contract (§9.2 of the plan doc) that this
    // fixture exercises.
    const building = squareAt(-40, -10, -20, 20, 60);
    const args = {
      launch, targetHeight: 80, shellRadius: 10, analysisRadius: 200,
      radialSpacing: 200, angularSpacing: 120, buildings: [building],
    };

    // Baseline: without terrain, the west-facing sector (index 1) is blocked.
    const withoutTerrain = computeViewshed(args);
    const westSectorWithout = withoutTerrain.features[1];
    expect(westSectorWithout.properties.frac).toBe(0);

    // Tiny local terrain patch covering ONLY [-105, -95] × [-5, 5] — 10m
    // square right under the observer. Everything else (launch, building,
    // ray samples between them) is outside this box, so terrain lookups
    // return null (→ 0m fallback). This isolates the observer's own
    // elevation as the only terrain effect. A wider plateau extending
    // toward the target would (correctly under Phase 4's terrain-as-
    // blocker) create a cliff that blocks the observer's view — physically
    // right, but not the invariant this test is exercising.
    const nw = projector.toLatLng(-105, 5);
    const se = projector.toLatLng(-95, -5);
    const cellsX = 4;
    const cellsY = 4;
    const data = new Float32Array(cellsX * cellsY);
    data.fill(200); // tiny peak at 200m
    const terrainGrid = new ElevationGrid({
      data, cellsX, cellsY,
      northLat: nw.lat, westLng: nw.lng,
      latStepDeg: (se.lat - nw.lat) / (cellsY - 1),
      lngStepDeg: (se.lng - nw.lng) / (cellsX - 1),
    });

    const withTerrain = computeViewshed({ ...args, terrainGrid });
    const westSectorWith = withTerrain.features[1];
    // Going from 0 (fully blocked) to any positive number is the physics
    // signal that the terrain integration is doing work.
    expect(westSectorWith.properties.frac).toBeGreaterThan(0);
  });
});

describe("computeViewshed with terrain — Phase 4 terrain-as-blocker", () => {
  it("blocks a sightline that a hill between launch and observer stands in", () => {
    // The killer scenario in miniature (Twin Peaks between Ferry
    // Building and hilltop viewer): launch at origin, no buildings at
    // all, observer at (-100, 0) — sightline over flat ground would be
    // completely clear. Add a terrain ridge at x ∈ [-70, -30] rising to
    // 300m. That's directly on the observer→launch sightline, and it's
    // way above both launch-burst altitude (80m) and observer eye (1.6m
    // in the "no elevation for observer" region).
    //
    // Phase 3 code would still show this as visible (buildings-only, no
    // terrain occlusion). Phase 4's radial sweep samples terrain along
    // the ray every 20m, so d=40 and d=60 (both inside the ridge) would
    // return 300m and become blocking obstacles.
    const args = {
      launch, targetHeight: 80, shellRadius: 10, analysisRadius: 200,
      radialSpacing: 200, angularSpacing: 120, buildings: [],
    };

    // Terrain grid: mostly 0m, with a ridge in x ∈ [-70, -30].
    const nw = projector.toLatLng(-150, 30);
    const se = projector.toLatLng(30, -30);
    const cellsX = 20;
    const cellsY = 4;
    const data = new Float32Array(cellsX * cellsY);
    // Column layout: 20 cells over [-150, 30] means step = 180/19 ≈ 9.5m
    //   col 0 = -150, col 8 ≈ -74, col 12 ≈ -36, col 19 = 30
    // Ridge in cols where x ∈ [-70, -30] — cols ~8-12.
    for (let row = 0; row < cellsY; row++) {
      for (let col = 8; col <= 12; col++) {
        data[row * cellsX + col] = 300;
      }
    }
    const terrainGrid = new ElevationGrid({
      data, cellsX, cellsY,
      northLat: nw.lat, westLng: nw.lng,
      latStepDeg: (se.lat - nw.lat) / (cellsY - 1),
      lngStepDeg: (se.lng - nw.lng) / (cellsX - 1),
    });

    // No terrain: everything clear (empty buildings list, flat ground).
    const withoutTerrain = computeViewshed(args);
    expect(withoutTerrain.features[1].properties.frac).toBe(1);

    // With terrain ridge: the west-facing sector should now be blocked
    // by the ridge, even though there are zero buildings.
    const withTerrain = computeViewshed({ ...args, terrainGrid });
    expect(withTerrain.features[1].properties.frac).toBe(0);
  });
});

describe("computeSightlineProfile with terrain", () => {
  it("passes through unchanged when terrainGrid is null", () => {
    const observer = { lat: launch.lat, lng: launch.lng - 0.001 };
    const args = {
      observer, launch, targetHeight: 100, shellRadius: 20,
      buildings: [squareAt(-30, -10, -10, 10, 40)],
      observerHeight: 1.6,
    };
    const omitted = computeSightlineProfile(args);
    const nulled = computeSightlineProfile({ ...args, terrainGrid: null });
    expect(nulled.frac).toBe(omitted.frac);
    expect(nulled.category).toBe(omitted.category);
    expect(nulled.hits).toEqual(omitted.hits);
  });

  it("blocks the profile when a terrain ridge stands between observer and launch (phase 5)", () => {
    // The single-point sibling of the grid test above. Observer far
    // west of launch, no buildings, but a ridge in between rising to
    // 300m. Without terrain the profile reads fully visible; with
    // terrain the ridge is sampled along the sightline (every 20m per
    // TERRAIN_STEP in computeProfile.js), one of those samples lands
    // inside the ridge, and its req dominates minAlt.
    const observer = { ...projector.toLatLng(-100, 0) }; // 100m west of launch
    const args = {
      observer, launch, targetHeight: 80, shellRadius: 10,
      buildings: [], observerHeight: 1.6,
    };
    // Same ridge fixture as the grid test's phase-4 case
    const nw = projector.toLatLng(-150, 30);
    const se = projector.toLatLng(30, -30);
    const cellsX = 20;
    const cellsY = 4;
    const data = new Float32Array(cellsX * cellsY);
    for (let row = 0; row < cellsY; row++) {
      for (let col = 8; col <= 12; col++) {
        data[row * cellsX + col] = 300;
      }
    }
    const terrainGrid = new ElevationGrid({
      data, cellsX, cellsY,
      northLat: nw.lat, westLng: nw.lng,
      latStepDeg: (se.lat - nw.lat) / (cellsY - 1),
      lngStepDeg: (se.lng - nw.lng) / (cellsX - 1),
    });

    const flat = computeSightlineProfile(args);
    expect(flat.frac).toBe(1);

    const withRidge = computeSightlineProfile({ ...args, terrainGrid });
    expect(withRidge.frac).toBe(0);
    // terrainProfile should have the ridge's ~300m samples in it
    const maxTerrainElev = Math.max(...withRidge.terrainProfile.map((s) => s.elevation));
    expect(maxTerrainElev).toBeGreaterThan(200); // interpolation may soften the peak
  });

  it("returns identical result under a uniform 300m terrain lift", () => {
    // Same invariant as the ground-grid test above but for the profile
    // path — every height baseline moves in lock-step, geometry is
    // preserved.
    const observer = { lat: launch.lat, lng: launch.lng - 0.001 };
    const args = {
      observer, launch, targetHeight: 100, shellRadius: 20,
      buildings: [squareAt(-30, -10, -10, 10, 40)],
      observerHeight: 1.6,
    };
    const flat = computeSightlineProfile(args);
    const elevated = computeSightlineProfile({ ...args, terrainGrid: uniformTerrainGrid(300) });
    expect(elevated.frac).toBeCloseTo(flat.frac, 6);
    expect(elevated.category).toBe(flat.category);
    // hits' req values shift by +300m (they're in absolute altitude now)
    // but the relative geometry that produced them is identical.
    for (let i = 0; i < flat.hits.length; i++) {
      expect(elevated.hits[i].req).toBeCloseTo(flat.hits[i].req + 300, 4);
    }
  });
});

import { makeLocalProjector } from "@/lib/geo/toLocalMeters";
import { intersectSegmentBuilding } from "@/lib/viewshed/sightline";
import { buildBuildingIndex, queryBuildingIndex } from "@/lib/viewshed/buildingIndex";
import {
  fractionVisible,
  score as compositeScore,
  elevationAngleDeg,
  apparentAngularDiameterDeg,
  comfortFactor,
  visibilityCategory,
  EYE_HEIGHT,
} from "@/lib/viewshed/scoring";

/**
 * Polar grid of observer points radiating out from the launch point, each
 * scored for visibility fraction. Output is one Polygon (annular sector)
 * Feature per (ring, sector) cell rather than a Point — rendered as a `fill`
 * layer this reads as rays/rings radiating from the launch marker instead of
 * a scattered grid of dots, which is the point of sampling in polar (r, θ)
 * rather than Cartesian (x, y) in the first place.
 *
 * Ground level only (every observer at EYE_HEIGHT) — this grid answers "can
 * you see it standing at street level here." Rooftop visibility is a
 * separate, per-building computation (lib/viewshed/computeRooftopLayer.js):
 * a polar grid can't align its cell boundaries with real building outlines,
 * so a cell straddling half a building and half a street has no honest
 * single color to paint it. See notes.md and 可视域计算优化方案.md for the
 * fuller diagnosis — this file used to carry an `observerMode: "rooftop"`
 * option that tried to do this per grid cell; it's gone in favor of that
 * separate building-shaped layer.
 *
 * Each cell carries `frac` (pure line-of-sight occlusion), `score` (frac
 * folded together with apparent angular size and viewing-angle comfort, per
 * 烟花可视性数学模型.md §7), and `category` — a discrete
 * blocked/poor-angle/partial/good classification. Render layers should color
 * by `category`, not the continuous `score`: a fully clear sightline at an
 * uncomfortable angle (score=0) and an actually building-blocked point
 * (score=0) both collapse to the same number, but they're different
 * problems and need different colors — see scoring.js's `visibilityCategory`.
 *
 * @param {object} args
 * @param {{lat:number,lng:number}} args.launch
 * @param {number} args.targetHeight - H, the launch point's height in meters
 * @param {number} args.shellRadius - R, the firework shell's vertical radius in meters
 * @param {number} args.analysisRadius - horizontal extent of the grid in meters
 *   (deliberately a different name from shellRadius — the source docs call both
 *   "radius," which is a real ambiguity bug waiting to happen)
 * @param {number} [args.radialSpacing=20] - meters between rings
 * @param {number} [args.angularSpacing=6] - degrees between sectors
 * @param {Array<{footprint: Array<Array<[number,number]>>, base: number, height: number}>} args.buildings
 *   normalizeBuilding() output; footprint rings are still [lng, lat] pairs, projected here
 * @param {import("./ElevationGrid").ElevationGrid} [args.terrainGrid] - optional.
 *   When present, all heights are lifted to absolute sea-level altitudes:
 *   `launch → terrain(launch)+targetHeight`, `observer → terrain(observer)+EYE_HEIGHT`,
 *   `building.height → terrain(building centroid)+building.height`. When omitted
 *   (or null), terrain contributions are treated as 0 everywhere and behavior
 *   is byte-identical to the pre-Phase-3 code path — the 702 pre-existing
 *   tests rely on that (see 地形高程集成_实施方案.md §6). Points outside the
 *   grid's coverage fall back to 0m too; the intersection math stays intact
 *   because it only compares heights, and consistent baselines cancel out.
 */
export function computeViewshed({
  launch,
  targetHeight,
  shellRadius,
  analysisRadius,
  radialSpacing = 20,
  angularSpacing = 6,
  buildings,
  terrainGrid = null,
}) {
  const projector = makeLocalProjector(launch.lat, launch.lng);
  // Terrain-lookup helper — returns 0 when grid is absent OR the point is
  // outside the loaded coverage rect. Both cases are treated as flat
  // ground, since the alternative (throw on out-of-coverage) would fire
  // for the edges of every analysis where the DEM tile pad doesn't fully
  // cover the analysis radius.
  const groundElev = (lng, lat) =>
    terrainGrid ? (terrainGrid.getElevation(lng, lat) ?? 0) : 0;

  const launchElev = groundElev(launch.lng, launch.lat);
  const target = { x: 0, y: 0, z: launchElev + targetHeight };

  const localBuildings = buildings.map((b) => {
    // Centroid of the outer ring in lat/lng (footprint is [[lng,lat], …]).
    const ring = b.footprint[0];
    const verts = ring.slice(0, -1); // drop closing duplicate
    let sumLng = 0;
    let sumLat = 0;
    for (const [vLng, vLat] of verts) {
      sumLng += vLng;
      sumLat += vLat;
    }
    const centroidLng = sumLng / verts.length;
    const centroidLat = sumLat / verts.length;
    const bldgElev = groundElev(centroidLng, centroidLat);
    return {
      // Roofline in absolute altitude (terrain + building height). One
      // baseline per building — see 实施方案.md §4.5 for why individual
      // corners can't use different bases (would produce non-flat roofs
      // in the intersection math and visibly wrong occlusion at steep
      // sites).
      height: bldgElev + b.height,
      footprint: b.footprint.map((ring2) =>
        ring2.map(([lng, lat]) => projector.toLocal(lat, lng))
      ),
    };
  });
  // Built once, queried per cell below — see lib/viewshed/buildingIndex.js
  // for why this matters at real building counts (a dense downtown can put
  // thousands of buildings in front of ~2000+ grid cells).
  const buildingIndex = buildBuildingIndex(localBuildings);

  const numRings = Math.floor(analysisRadius / radialSpacing);
  const numSectors = Math.round(360 / angularSpacing);
  const angleStep = (2 * Math.PI) / numSectors;

  // Terrain sampling density along each bearing ray. Coarser than the
  // ~10m/pixel AWS Terrain Tiles resolution (see ElevationGrid.js) but
  // fine enough to catch the ridges that matter — a Twin Peaks-scale
  // hill is hundreds of meters wide, easily captured at 20m. Trade-off:
  // finer = more work per sector (75 samples → 150 at 10m); coarser =
  // risk missing narrow ridges (a 10m-wide ridge would be undersampled).
  const TERRAIN_STEP = 20;

  const features = [];
  let totalObstacles = 0;
  const targetAbsAlt = target.z;

  // Radial sweep — see 地形高程集成_实施方案.md §4.4. Outer loop is by
  // sector (bearing), because within one sector all rings' sample points
  // sit exactly on the sector's centerline ray (by construction:
  // observer = midR·(cos midTheta, sin midTheta)). So a single set of
  // obstacles (buildings that intersect the ray + terrain samples along
  // it) suffices for the whole sector — no need to re-query buildings
  // per cell as the pre-Phase-4 code did.
  //
  // The inner loop over obstacles is cheap arithmetic (one division +
  // one comparison per obstacle), replacing the pre-Phase-4 per-cell
  // intersectSegmentBuilding call (which iterates every vertex of every
  // candidate building's footprint ring). Net: fewer expensive
  // ring-intersection tests, more cheap distance-vs-height math.
  for (let sectorIndex = 0; sectorIndex < numSectors; sectorIndex++) {
    const thetaInner = sectorIndex * angleStep;
    const thetaOuter = thetaInner + angleStep;
    const midTheta = thetaInner + angleStep / 2;
    const cosMid = Math.cos(midTheta);
    const sinMid = Math.sin(midTheta);

    // Segment from launch (t=0) to the farthest observer along this
    // bearing (t=1 at distance analysisRadius). z=0 on both endpoints
    // because intersectSegmentBuilding's ring math is 2D-only; the z is
    // only used to compute a `req` field we discard here (we recompute
    // per-observer req below with the correct observer altitude).
    const rayStart = { x: 0, y: 0, z: 0 };
    const rayEnd = { x: analysisRadius * cosMid, y: analysisRadius * sinMid, z: 0 };

    // Buildings whose bbox the ray's grid-cell walk passes through — a
    // superset of buildings the ray actually intersects (buildingIndex's
    // usual contract). Query once per sector, then filter via the
    // exact ring math.
    const rayCandidates = queryBuildingIndex(buildingIndex, rayStart, rayEnd);
    const obstacles = [];
    for (const bldg of rayCandidates) {
      const hit = intersectSegmentBuilding(rayStart, rayEnd, bldg);
      if (!hit) continue;
      // hit.tEntry / hit.tExit are along the LAUNCH → rayEnd segment.
      // For occlusion math we need the observer-facing (near-from-
      // observer) edge — which is the FURTHER-from-launch edge, i.e.
      // hit.tExit. Using hit.tEntry would put the "distance" at the
      // launch-facing edge, and the req formula below would compute the
      // wrong altitude required to clear a building's back wall instead
      // of its front wall from the observer's POV.
      obstacles.push({
        distance: hit.tExit * analysisRadius,
        height: bldg.height, // absolute altitude (terrain + building height,
                             // already baked in during localBuildings construction)
      });
    }
    // Terrain samples along the ray, treated as small "obstacles" — see
    // 地形高程集成_实施方案.md §4.4. Skipping d < TERRAIN_STEP so we
    // don't include the launch pad itself as an obstacle for observers
    // just past it (would give absurdly large req values).
    if (terrainGrid) {
      for (let d = TERRAIN_STEP; d <= analysisRadius; d += TERRAIN_STEP) {
        const x = d * cosMid;
        const y = d * sinMid;
        const { lat, lng } = projector.toLatLng(x, y);
        const elev = groundElev(lng, lat);
        obstacles.push({ distance: d, height: elev });
      }
    }
    // Sort by distance so the inner loop can early-exit once it passes
    // the observer.
    obstacles.sort((a, b) => a.distance - b.distance);
    totalObstacles += obstacles.length;

    for (let ringIndex = 0; ringIndex < numRings; ringIndex++) {
      const rInner = ringIndex * radialSpacing;
      const rOuter = rInner + radialSpacing;
      const midR = (rInner + rOuter) / 2;
      const obsX = midR * cosMid;
      const obsY = midR * sinMid;
      // Cell's sample-point terrain lookup. When terrainGrid is null,
      // this is 0 and every observer sits at EYE_HEIGHT above z=0 —
      // the pre-Phase-3 baseline.
      const { lat: sampleLat, lng: sampleLng } = projector.toLatLng(obsX, obsY);
      const cellGroundElev = groundElev(sampleLng, sampleLat);
      const observerAbsAlt = cellGroundElev + EYE_HEIGHT;

      // Minimum target altitude required to be seen over every obstacle
      // between this observer and the burst.
      // For an obstacle at (distance d_B, height h_B) with observer at
      // (midR, observerAbsAlt) and target at (0, T):
      //   Line altitude at d_B = observerAbsAlt + (T - observerAbsAlt)·(midR - d_B)/midR
      //   Setting altitude = h_B and solving for T (the required target height):
      //     T_req = observerAbsAlt + (h_B - observerAbsAlt) · midR / (midR - d_B)
      let minAlt = -Infinity;
      for (const { distance, height } of obstacles) {
        if (distance >= midR) break; // sorted — later obstacles are past observer
        const req = observerAbsAlt + (height - observerAbsAlt) * midR / (midR - distance);
        if (req > minAlt) minAlt = req;
      }

      const frac = fractionVisible(minAlt, targetAbsAlt, shellRadius);
      const cellScore = compositeScore({
        minAlt,
        targetHeight: targetAbsAlt,
        shellRadius,
        eyeHeight: observerAbsAlt,
        horizontalDistance: midR,
      });
      // Elevation angle / apparent size use the observer→burst vertical
      // delta. Post-Phase-3 this can be negative (a hilltop observer
      // looking down at a sea-level burst) — scoring.js's elevationScore
      // already returns 0 for phi <= 5°, so this stays consistent with
      // the pre-terrain behavior for negative angles (poor-angle
      // category); making that smarter is a scoring.js concern, not a
      // terrain-integration concern.
      const heightDiff = targetAbsAlt - observerAbsAlt;
      const theta = apparentAngularDiameterDeg(midR, heightDiff, shellRadius);
      const phi = elevationAngleDeg(midR, heightDiff);
      const category = visibilityCategory(frac, comfortFactor(theta, phi));

      const corners = [
        [rInner * Math.cos(thetaInner), rInner * Math.sin(thetaInner)],
        [rOuter * Math.cos(thetaInner), rOuter * Math.sin(thetaInner)],
        [rOuter * Math.cos(thetaOuter), rOuter * Math.sin(thetaOuter)],
        [rInner * Math.cos(thetaOuter), rInner * Math.sin(thetaOuter)],
      ];
      const sectorRing = [...corners, corners[0]].map(([cx, cy]) => {
        const { lat, lng } = projector.toLatLng(cx, cy);
        return [lng, lat];
      });

      // sampleLat/sampleLng were computed above for the terrain lookup —
      // reused here to stash in properties so downstream callers
      // (LaunchPointControl.jsx's top-spots picker) can place markers at
      // exactly the point this cell's score was measured for, instead of
      // averaging the sector's corners back out.
      features.push({
        type: "Feature",
        properties: { frac, score: cellScore, category, sampleLat, sampleLng },
        geometry: { type: "Polygon", coordinates: [sectorRing] },
      });
    }
  }

  // Extra field on the FeatureCollection, not part of GeoJSON proper —
  // maplibre's setData() only reads type/features and ignores it. The name
  // stays `avgCandidates` for the perf HUD's continuity across Phase 4;
  // the number itself now means "average obstacles per sector" (a sector
  // touches numRings cells, so per-cell candidate count = this / numRings).
  const avgCandidates = numSectors > 0 ? totalObstacles / numSectors : 0;
  return { type: "FeatureCollection", features, avgCandidates };
}

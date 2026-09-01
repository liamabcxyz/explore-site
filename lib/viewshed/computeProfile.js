import { makeLocalProjector } from "@/lib/geo/toLocalMeters";
import { intersectSegmentBuilding } from "@/lib/viewshed/sightline";
import { apparentAltitude } from "@/lib/viewshed/curvature";
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
 * Full sightline breakdown for a single observer -> launch point pair — every
 * building the line crosses, in distance order, not just the tallest
 * requirement. computeViewshed.js only needs the single frac per grid point;
 * this is what the profile/"why" view needs to tell the whole story for one
 * point the user picked.
 *
 * @param {object} args
 * @param {{lat:number,lng:number}} args.observer
 * @param {{lat:number,lng:number}} args.launch
 * @param {number} args.targetHeight - H, the launch point's height in meters
 * @param {number} args.shellRadius - R, the firework shell's vertical radius in meters
 * @param {Array<{footprint: Array<Array<[number,number]>>, height: number, confidence: string}>} args.buildings
 *   normalizeBuilding() output; footprint rings are [lng, lat] pairs, projected here
 * @param {number} [args.observerHeight=EYE_HEIGHT] - absolute height (meters
 *   above the z=0 ground plane) the observer is standing at. Defaults to
 *   standing at ground level; a caller that's detected the observer point
 *   sits on a building can pass a higher value (a floor, or the roof) —
 *   see lib/geo/rooftopBase.js's findBuildingAt and todo.md's "observer on a
 *   building" item. This is the mirror case of P1-3 (launch point on a
 *   building) but for the other end of the sightline.
 * @param {Array<{fromMeters:number,toMeters:number,source:string}>} [args.coverageGaps]
 *   Ranges along the sightline where building or terrain tiles were missing.
 *   Occlusion math cannot see those ranges; the profile flags dataIncomplete
 *   so the UI does not present a clean "fully visible" as a certainty.
 */
export function computeSightlineProfile({
  observer,
  launch,
  targetHeight,
  shellRadius,
  buildings,
  observerHeight = EYE_HEIGHT,
  terrainGrid = null,
  coverageGaps = [],
}) {
  const projector = makeLocalProjector(launch.lat, launch.lng);
  // Same terrain-lookup helper shape as computeViewshed / computeRooftopLayer:
  // null grid or out-of-coverage point → 0m, which collapses the absolute-
  // altitude math back to the pre-Phase-3 relative-altitude behavior.
  const groundElev = (lng, lat) =>
    terrainGrid ? (terrainGrid.getElevation(lng, lat) ?? 0) : 0;
  const launchElev = groundElev(launch.lng, launch.lat);
  const observerGroundElev = groundElev(observer.lng, observer.lat);
  const targetAbsAlt = launchElev + targetHeight;
  const observerAbsAlt = observerGroundElev + observerHeight;
  const target = { x: 0, y: 0, z: targetAbsAlt };
  const obs = { ...projector.toLocal(observer.lat, observer.lng), z: observerAbsAlt };

  const totalDistance = Math.hypot(target.x - obs.x, target.y - obs.y);
  // Curvature is <0.3m inside the 1.5km heat-map radius and is dominated
  // by building-height noise there. Applying it always would perturb the
  // existing short-range fixtures for no product gain. Long sightlines
  // (the reason this exists) start mattering around a few kilometers.
  const CURVATURE_MIN_METERS = 2000;
  const lift = (asl, distance) =>
    totalDistance >= CURVATURE_MIN_METERS ? apparentAltitude(asl, distance) : asl;

  const localBuildings = buildings.map((b) => {
    // Same centroid-terrain lookup as computeViewshed — one absolute base
    // per building, so the intersection math stays consistent.
    const ring = b.footprint[0];
    const verts = ring.slice(0, -1);
    let sumLng = 0;
    let sumLat = 0;
    for (const [vLng, vLat] of verts) {
      sumLng += vLng;
      sumLat += vLat;
    }
    const bldgGroundElev = groundElev(sumLng / verts.length, sumLat / verts.length);
    return {
      height: bldgGroundElev + b.height,
      confidence: b.confidence,
      name: b.name ?? null,
      rawFootprint: b.footprint,
      footprint: b.footprint.map((ring2) => ring2.map(([lng, lat]) => projector.toLocal(lat, lng))),
    };
  });

  const hits = [];
  for (const building of localBuildings) {
    const hit = intersectSegmentBuilding(obs, target, building);
    if (hit) {
      const distance = hit.tEntry * totalDistance;
      // intersectSegmentBuilding's req is in the raw ASL frame. Recompute
      // in the observer-tangent (curvature-corrected) frame so a 20km
      // sightline isn't systematically optimistic. hits[].height stays ASL
      // so the chart/labels still say "51m building."
      const bldgApparent = lift(building.height, distance);
      const req = observerAbsAlt + (bldgApparent - observerAbsAlt) / hit.tEntry;
      hits.push({
        distance,
        height: building.height,
        confidence: building.confidence,
        req,
        footprint: building.rawFootprint,
        name: building.name,
      });
    }
  }
  hits.sort((a, b) => a.distance - b.distance);

  // Terrain sampled every 20m along observer → launch, matching Phase 4's
  // radial-sweep approach in computeViewshed.js (see 地形高程集成_实施方案.md
  // §4.4). Two outputs from the sample walk: the terrainProfile array for
  // ProfilePanel's SVG (so the chart can draw the ground profile as a
  // filled polygon), and additional obstacle requirements folded into
  // minAlt (so terrain blocks sightlines just like buildings). Falls back
  // to a two-point flat profile when no terrainGrid is available, so the
  // SVG code has consistent input shape.
  const TERRAIN_STEP = 20;
  const terrainProfile = [];
  let terrainMaxReq = -Infinity;
  if (totalDistance > 0) {
    // Parametric distance-from-observer along the observer→target segment.
    const dirX = (target.x - obs.x) / totalDistance;
    const dirY = (target.y - obs.y) / totalDistance;
    // include both endpoints (d=0 and d=totalDistance) plus 20m steps
    // between them; final point ensures the SVG polygon closes at the
    // launch side.
    const distances = [];
    for (let d = 0; d <= totalDistance; d += TERRAIN_STEP) distances.push(d);
    if (distances[distances.length - 1] < totalDistance) distances.push(totalDistance);
    for (const d of distances) {
      const x = obs.x + dirX * d;
      const y = obs.y + dirY * d;
      const { lat, lng } = projector.toLatLng(x, y);
      const elev = groundElev(lng, lat);
      terrainProfile.push({ distance: d, elevation: elev });
      // Only fold terrain into the blocker computation when we actually
      // have a real terrain grid. Without one, `elev` is 0 everywhere by
      // fallback, and a `(0 - observerAbsAlt)/t` req would inject
      // spurious negative values that pull minAlt away from its
      // pre-Phase-5 -Infinity default (the "no obstacles" sentinel that
      // fractionVisible's k <= -1 boundary check resolves cleanly to
      // frac=1). Skip endpoints: d=0 sits under the observer, d ≈
      // totalDistance sits at the launch pad — same near-launch skip
      // logic Phase 4 uses.
      if (!terrainGrid) continue;
      if (d < 5 || d > totalDistance - 5) continue;
      const t = d / totalDistance;
      const elevApparent = lift(elev, d);
      const req = observerAbsAlt + (elevApparent - observerAbsAlt) / t;
      if (req > terrainMaxReq) terrainMaxReq = req;
    }
  }

  const minAlt = Math.max(
    hits.reduce((max, h) => Math.max(max, h.req), -Infinity),
    terrainMaxReq
  );
  const targetApparentAlt = lift(targetAbsAlt, totalDistance);
  const frac = fractionVisible(minAlt, targetApparentAlt, shellRadius);

  // totalDistance is horizontal-only (no z) despite the name — a trap for
  // anyone reaching for "the" distance in slant-range math, so it's called
  // out here rather than silently reused.
  const heightDiff = targetApparentAlt - observerAbsAlt;
  const theta = apparentAngularDiameterDeg(totalDistance, heightDiff, shellRadius);
  const phi = elevationAngleDeg(totalDistance, heightDiff);
  const compositeScoreValue = compositeScore({
    minAlt,
    targetHeight: targetApparentAlt,
    shellRadius,
    eyeHeight: observerAbsAlt,
    horizontalDistance: totalDistance,
  });
  // See scoring.js's visibilityCategory — ProfilePanel should color/label by
  // this, not by score/frac thresholds alone, so "clear but bad angle" never
  // reads the same as "actually blocked by a building."
  const category = visibilityCategory(frac, comfortFactor(theta, phi));

  return {
    totalDistance,
    // eyeHeight / targetHeight stay in their pre-Phase-3 semantics
    // ("relative to local ground") for callers/tests that already consume
    // them at that meaning. The two *AbsAlt fields below are the terrain-
    // aware absolute companions ProfilePanel's SVG plots on the same axis
    // as hits[].height (which post-Phase-3 is already absolute).
    eyeHeight: observerHeight,
    targetHeight,
    observerAbsAlt,
    targetAbsAlt,
    targetApparentAlt,
    observerGroundElev,
    launchElev,
    coverageGaps,
    dataIncomplete: coverageGaps.length > 0,
    shellRadius,
    minAlt,
    frac,
    theta,
    phi,
    score: compositeScoreValue,
    category,
    hits,
    // Ground profile along observer→launch, meters ASL. Empty only if
    // totalDistance is 0 (observer landed exactly on the launch point,
    // pathological); otherwise contains at least two endpoints — every
    // consumer can iterate it uniformly. Zeros throughout when no
    // terrainGrid was supplied.
    terrainProfile,
  };
}

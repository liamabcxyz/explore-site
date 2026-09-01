import { makeLocalProjector } from "@/lib/geo/toLocalMeters";
import { computeMinAlt } from "@/lib/viewshed/sightline";
import {
  fractionVisible,
  score as compositeScore,
  elevationAngleDeg,
  apparentAngularDiameterDeg,
  comfortFactor,
  visibilityCategory,
  isBlocked,
  EYE_HEIGHT,
} from "@/lib/viewshed/scoring";

// A building whose footprint bbox diagonal exceeds this gets a few extra
// occlusion samples near its own corners, not just the centroid — a single
// centroid sample silently picks one side's answer for a building whose
// roof genuinely spans "visible from here, blocked over there" (a full
// block, a stadium, an L-shaped complex). Below this, one sample is treated
// as representative — see notes.md and 可视域计算优化方案.md's deferred
// "大屋顶多点采样" item. Provisional first-pass guess, same spirit as
// scoring.js's other thresholds: comfortably above a typical rowhouse's
// footprint diagonal, comfortably below a full city block's.
const LARGE_BUILDING_EXTENT_METERS = 40;

function footprintBBox(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function nearestVertexTo(ring, point) {
  let best = ring[0];
  let bestDistSq = Infinity;
  for (const vertex of ring) {
    const distSq = (vertex.x - point.x) ** 2 + (vertex.y - point.y) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = vertex;
    }
  }
  return best;
}

// Real footprint vertices near the bbox's 4 corners, not the synthetic bbox
// corners themselves — a synthetic corner can fall outside a concave/
// L-shaped footprint, which would break the "needs 2 crossings to
// self-occlude" property intersectSegmentBuilding relies on (see the
// centroid comment below): that property holds for any point on/inside the
// building's own boundary, not for a point floating just outside it. Real
// vertices keep the same guarantee the centroid already depends on.
function extraSamplePoints(ring) {
  const { minX, minY, maxX, maxY } = footprintBBox(ring);
  if (Math.hypot(maxX - minX, maxY - minY) <= LARGE_BUILDING_EXTENT_METERS) return [];

  const corners = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  const seen = new Set();
  const points = [];
  for (const corner of corners) {
    const vertex = nearestVertexTo(ring, corner);
    const key = `${vertex.x},${vertex.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push(vertex);
  }
  return points;
}

// Plain average of a ring's vertices (excluding the closing duplicate of
// ring[0]) as a stand-in for the building's centroid — not a true
// area-weighted polygon centroid, so a very concave/L-shaped footprint's
// average could in principle fall outside its own outline. Good enough to
// pick one representative rooftop point per building; nothing in this
// codebase has needed the exact centroid before, so this isn't worth a
// heavier algorithm until a real building actually produces a visibly wrong
// result.
function ringCentroid(ring) {
  const points = ring.slice(0, -1);
  const sum = points.reduce(
    (acc, [lng, lat]) => ({ lng: acc.lng + lng, lat: acc.lat + lat }),
    { lng: 0, lat: 0 }
  );
  return { lng: sum.lng / points.length, lat: sum.lat / points.length };
}

/**
 * The "rooftop view" counterpart to computeViewshed.js's ground-level polar
 * grid — but one visibility result per *building*, painted onto that
 * building's own real footprint, rather than one result per grid cell
 * painted onto an approximated wedge. A polar grid's cell boundaries can't
 * line up with real building outlines, so a cell straddling half a rooftop
 * and half a street has no honest single color; computing per building
 * instead makes the rendered color boundary exactly the building's own
 * outline, by construction. See notes.md and 可视域计算优化方案.md.
 *
 * `category` is usually one of scoring.js's four (blocked/poor-angle/
 * partial/good), from a single sample at the building's centroid — except
 * for buildings past LARGE_BUILDING_EXTENT_METERS, which also get checked
 * at a few points near their own corners; if those disagree with the
 * centroid on blocked-vs-not, `category` is `"mixed"` instead (not one of
 * scoring.js's four — deliberately not reusing "partial", which already
 * means something else: a single point's partial *shell* clearance, not
 * "part of this roof sees it and part doesn't").
 *
 * @param {object} args
 * @param {{lat:number,lng:number}} args.launch
 * @param {number} args.targetHeight - H, the launch point's height in meters
 * @param {number} args.shellRadius - R, the firework shell's vertical radius in meters
 * @param {Array<{footprint: Array<Array<[number,number]>>, height: number}>} args.buildings
 *   normalizeBuilding() output, already filtered to the relevant radius by
 *   the caller (the same list computeViewshed.js's ground grid uses) — not
 *   re-filtered here.
 * @param {import("./ElevationGrid").ElevationGrid} [args.terrainGrid] -
 *   optional; see computeViewshed.js for the semantics. Every building's
 *   own centroid terrain elevation lifts both the observer (this
 *   building's rooftop) and the same building's contribution to the
 *   occluder set. Omitted → all zeros, byte-identical to pre-Phase-3.
 */
export function computeRooftopLayer({ launch, targetHeight, shellRadius, buildings, terrainGrid = null }) {
  const projector = makeLocalProjector(launch.lat, launch.lng);
  const groundElev = (lng, lat) =>
    terrainGrid ? (terrainGrid.getElevation(lng, lat) ?? 0) : 0;
  const launchElev = groundElev(launch.lng, launch.lat);
  const target = { x: 0, y: 0, z: launchElev + targetHeight };

  // Pre-compute each building's centroid + terrain elevation so we don't
  // recompute during the observer loop below (each building serves BOTH
  // as an observer position and as a potential occluder for every other
  // observer — the two paths share the same centroid).
  const localBuildings = buildings.map((b) => {
    const ring = b.footprint[0];
    const verts = ring.slice(0, -1);
    let sumLng = 0;
    let sumLat = 0;
    for (const [vLng, vLat] of verts) {
      sumLng += vLng;
      sumLat += vLat;
    }
    const centroidLng = sumLng / verts.length;
    const centroidLat = sumLat / verts.length;
    const bldgGroundElev = groundElev(centroidLng, centroidLat);
    return {
      height: bldgGroundElev + b.height, // absolute roofline altitude
      bldgGroundElev, // saved so the observer loop can compute eye altitude
      footprint: b.footprint.map((ring2) => ring2.map(([lng, lat]) => projector.toLocal(lat, lng))),
    };
  });
  // Deliberately not run through lib/viewshed/buildingIndex.js the way
  // computeViewshed.js's ground grid is: this loop calls computeMinAlt once
  // per *building* (O(buildings)), not once per grid cell — even at 6500+
  // buildings that's ~6.5K calls, vs. the grid's ~2000-cells x buildings.
  // Building + querying the index would cost more than the brute-force scan
  // it's replacing at this call volume.

  const features = [];
  for (let i = 0; i < buildings.length; i++) {
    const building = buildings[i];
    const centroid = ringCentroid(building.footprint[0]);
    const { x, y } = projector.toLocal(centroid.lat, centroid.lng);
    // Standing on this building's own roof — same premise as
    // computeProfile.js's per-point observerHeight, just always "the roof"
    // rather than a user-picked floor, since this layer exists specifically
    // to answer "what if you were up here."
    // Observer is at this building's rooftop, in absolute altitude:
    // terrain elevation at building centroid + building's own height +
    // eye-height. When terrainGrid is null, bldgGroundElev is 0 and this
    // matches the pre-Phase-3 relative-height formulation.
    const bldgGroundElev = localBuildings[i].bldgGroundElev;
    const observerAbsAlt = bldgGroundElev + building.height + EYE_HEIGHT;
    const observer = { x, y, z: observerAbsAlt };

    // The observer sits at (approximately) its own building's centroid, so
    // that building's segment-crossing count against itself comes out as
    // exactly one (exiting, never entering) rather than the two
    // intersectSegmentBuilding requires to register a hit — it doesn't
    // self-occlude. Deliberately not filtered out of localBuildings for
    // that reason; doing so explicitly here would just be redundant.
    const minAlt = computeMinAlt(observer, target, localBuildings);
    const targetAbsAlt = target.z;
    const frac = fractionVisible(minAlt, targetAbsAlt, shellRadius);

    const horizontalDistance = Math.hypot(x, y);
    const heightDiff = targetAbsAlt - observerAbsAlt;
    const theta = apparentAngularDiameterDeg(horizontalDistance, heightDiff, shellRadius);
    const phi = elevationAngleDeg(horizontalDistance, heightDiff);
    const cellScore = compositeScore({
      minAlt,
      targetHeight: targetAbsAlt,
      shellRadius,
      eyeHeight: observerAbsAlt,
      horizontalDistance,
    });
    let category = visibilityCategory(frac, comfortFactor(theta, phi));

    // Large buildings only (extraSamplePoints returns [] otherwise, so this
    // is a no-op for the vast majority): if a few extra points near the
    // roof's own corners disagree with the centroid on blocked-vs-not, the
    // centroid's single verdict isn't representative of the whole roof —
    // rather than splitting the footprint into per-sample regions (which
    // would scatter a lot of small colored patches across the map), the
    // whole building is marked "mixed" instead, same geometry as any other
    // category, just a color that says "look closer" rather than a
    // possibly-wrong single verdict.
    const extraPoints = extraSamplePoints(localBuildings[i].footprint[0]);
    if (extraPoints.length > 0) {
      const centroidBlocked = isBlocked(frac);
      const disagrees = extraPoints.some((point) => {
        const sampleObserver = { x: point.x, y: point.y, z: observerAbsAlt };
        const sampleMinAlt = computeMinAlt(sampleObserver, target, localBuildings);
        const sampleFrac = fractionVisible(sampleMinAlt, targetAbsAlt, shellRadius);
        return isBlocked(sampleFrac) !== centroidBlocked;
      });
      if (disagrees) category = "mixed";
    }

    features.push({
      type: "Feature",
      properties: { frac, score: cellScore, category, buildingHeight: building.height },
      // building.footprint is already an array of [lng,lat] rings — the
      // exact shape GeoJSON Polygon.coordinates expects — so it's used
      // as-is, no reprojection back out of local meters needed.
      geometry: { type: "Polygon", coordinates: building.footprint },
    });
  }

  return { type: "FeatureCollection", features };
}

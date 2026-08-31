import { makeLocalProjector } from "@/lib/geo/toLocalMeters";
import { computeMinAlt } from "@/lib/viewshed/sightline";
import {
  fractionVisible,
  score as compositeScore,
  elevationAngleDeg,
  apparentAngularDiameterDeg,
  comfortFactor,
  visibilityCategory,
  EYE_HEIGHT,
} from "@/lib/viewshed/scoring";

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
 * @param {object} args
 * @param {{lat:number,lng:number}} args.launch
 * @param {number} args.targetHeight - H, the launch point's height in meters
 * @param {number} args.shellRadius - R, the firework shell's vertical radius in meters
 * @param {Array<{footprint: Array<Array<[number,number]>>, height: number}>} args.buildings
 *   normalizeBuilding() output, already filtered to the relevant radius by
 *   the caller (the same list computeViewshed.js's ground grid uses) — not
 *   re-filtered here.
 */
export function computeRooftopLayer({ launch, targetHeight, shellRadius, buildings }) {
  const projector = makeLocalProjector(launch.lat, launch.lng);
  const target = { x: 0, y: 0, z: targetHeight };

  const localBuildings = buildings.map((b) => ({
    height: b.height,
    footprint: b.footprint.map((ring) => ring.map(([lng, lat]) => projector.toLocal(lat, lng))),
  }));

  const features = [];
  for (const building of buildings) {
    const centroid = ringCentroid(building.footprint[0]);
    const { x, y } = projector.toLocal(centroid.lat, centroid.lng);
    // Standing on this building's own roof — same premise as
    // computeProfile.js's per-point observerHeight, just always "the roof"
    // rather than a user-picked floor, since this layer exists specifically
    // to answer "what if you were up here."
    const observerHeight = building.height + EYE_HEIGHT;
    const observer = { x, y, z: observerHeight };

    // The observer sits at (approximately) its own building's centroid, so
    // that building's segment-crossing count against itself comes out as
    // exactly one (exiting, never entering) rather than the two
    // intersectSegmentBuilding requires to register a hit — it doesn't
    // self-occlude. Deliberately not filtered out of localBuildings for
    // that reason; doing so explicitly here would just be redundant.
    const minAlt = computeMinAlt(observer, target, localBuildings);
    const frac = fractionVisible(minAlt, targetHeight, shellRadius);

    const horizontalDistance = Math.hypot(x, y);
    const heightDiff = targetHeight - observerHeight;
    const theta = apparentAngularDiameterDeg(horizontalDistance, heightDiff, shellRadius);
    const phi = elevationAngleDeg(horizontalDistance, heightDiff);
    const cellScore = compositeScore({
      minAlt,
      targetHeight,
      shellRadius,
      eyeHeight: observerHeight,
      horizontalDistance,
    });
    const category = visibilityCategory(frac, comfortFactor(theta, phi));

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

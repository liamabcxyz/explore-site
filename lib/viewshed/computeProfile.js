import { makeLocalProjector } from "@/lib/geo/toLocalMeters";
import { intersectSegmentBuilding } from "@/lib/viewshed/sightline";
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
 */
export function computeSightlineProfile({
  observer,
  launch,
  targetHeight,
  shellRadius,
  buildings,
  observerHeight = EYE_HEIGHT,
}) {
  const projector = makeLocalProjector(launch.lat, launch.lng);
  const target = { x: 0, y: 0, z: targetHeight };
  const obs = { ...projector.toLocal(observer.lat, observer.lng), z: observerHeight };

  const totalDistance = Math.hypot(target.x - obs.x, target.y - obs.y);

  const localBuildings = buildings.map((b) => ({
    height: b.height,
    confidence: b.confidence,
    footprint: b.footprint.map((ring) => ring.map(([lng, lat]) => projector.toLocal(lat, lng))),
  }));

  const hits = [];
  for (const building of localBuildings) {
    const hit = intersectSegmentBuilding(obs, target, building);
    if (hit) {
      hits.push({
        distance: hit.tEntry * totalDistance,
        height: building.height,
        confidence: building.confidence,
        req: hit.req,
      });
    }
  }
  hits.sort((a, b) => a.distance - b.distance);

  const minAlt = hits.reduce((max, h) => Math.max(max, h.req), -Infinity);
  const frac = fractionVisible(minAlt, targetHeight, shellRadius);

  // totalDistance is horizontal-only (no z) despite the name — a trap for
  // anyone reaching for "the" distance in slant-range math, so it's called
  // out here rather than silently reused.
  const heightDiff = targetHeight - observerHeight;
  const theta = apparentAngularDiameterDeg(totalDistance, heightDiff, shellRadius);
  const phi = elevationAngleDeg(totalDistance, heightDiff);
  const compositeScoreValue = compositeScore({
    minAlt,
    targetHeight,
    shellRadius,
    eyeHeight: observerHeight,
    horizontalDistance: totalDistance,
  });
  // See scoring.js's visibilityCategory — ProfilePanel should color/label by
  // this, not by score/frac thresholds alone, so "clear but bad angle" never
  // reads the same as "actually blocked by a building."
  const category = visibilityCategory(frac, comfortFactor(theta, phi));

  return {
    totalDistance,
    eyeHeight: observerHeight,
    targetHeight,
    shellRadius,
    minAlt,
    frac,
    theta,
    phi,
    score: compositeScoreValue,
    category,
    hits,
  };
}

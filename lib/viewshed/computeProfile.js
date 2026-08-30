import { makeLocalProjector } from "@/lib/geo/toLocalMeters";
import { intersectSegmentBuilding } from "@/lib/viewshed/sightline";
import { fractionVisible } from "@/lib/viewshed/scoring";

const EYE_HEIGHT = 1.6;

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
 * @param {Array<{footprint: Array<Array<[number,number]>>, height: number}>} args.buildings
 *   normalizeBuilding() output; footprint rings are [lng, lat] pairs, projected here
 */
export function computeSightlineProfile({ observer, launch, targetHeight, shellRadius, buildings }) {
  const projector = makeLocalProjector(launch.lat, launch.lng);
  const target = { x: 0, y: 0, z: targetHeight };
  const obs = { ...projector.toLocal(observer.lat, observer.lng), z: EYE_HEIGHT };

  const totalDistance = Math.hypot(target.x - obs.x, target.y - obs.y);

  const localBuildings = buildings.map((b) => ({
    height: b.height,
    footprint: b.footprint.map((ring) => ring.map(([lng, lat]) => projector.toLocal(lat, lng))),
  }));

  const hits = [];
  for (const building of localBuildings) {
    const hit = intersectSegmentBuilding(obs, target, building);
    if (hit) {
      hits.push({ distance: hit.tEntry * totalDistance, height: building.height, req: hit.req });
    }
  }
  hits.sort((a, b) => a.distance - b.distance);

  const minAlt = hits.reduce((max, h) => Math.max(max, h.req), -Infinity);
  const frac = fractionVisible(minAlt, targetHeight, shellRadius);

  return { totalDistance, eyeHeight: EYE_HEIGHT, targetHeight, shellRadius, minAlt, frac, hits };
}

import { makeLocalProjector } from "@/lib/geo/toLocalMeters";
import { computeMinAlt } from "@/lib/viewshed/sightline";
import { fractionVisible } from "@/lib/viewshed/scoring";

const EYE_HEIGHT = 1.6;

/**
 * Grid of observer points around a launch point, each scored for visibility
 * fraction. Output is one Point Feature per grid cell (not a filled polygon
 * grid) — simplest thing that's correct; a rendering layer can turn this into
 * squares/circles later without the algorithm needing to know about that.
 *
 * @param {object} args
 * @param {{lat:number,lng:number}} args.launch
 * @param {number} args.targetHeight - H, the launch point's height in meters
 * @param {number} args.shellRadius - R, the firework shell's vertical radius in meters
 * @param {number} args.analysisRadius - horizontal extent of the grid in meters
 *   (deliberately a different name from shellRadius — the source docs call both
 *   "radius," which is a real ambiguity bug waiting to happen)
 * @param {number} [args.gridSpacing=20] - meters between grid points
 * @param {Array<{footprint: Array<Array<[number,number]>>, base: number, height: number}>} args.buildings
 *   normalizeBuilding() output; footprint rings are still [lng, lat] pairs, projected here
 */
export function computeViewshed({
  launch,
  targetHeight,
  shellRadius,
  analysisRadius,
  gridSpacing = 20,
  buildings,
}) {
  const projector = makeLocalProjector(launch.lat, launch.lng);
  const target = { x: 0, y: 0, z: targetHeight };

  const localBuildings = buildings.map((b) => ({
    height: b.height,
    footprint: b.footprint.map((ring) =>
      ring.map(([lng, lat]) => projector.toLocal(lat, lng))
    ),
  }));

  const features = [];
  for (let y = -analysisRadius; y <= analysisRadius; y += gridSpacing) {
    for (let x = -analysisRadius; x <= analysisRadius; x += gridSpacing) {
      if (x * x + y * y > analysisRadius * analysisRadius) continue;

      const observer = { x, y, z: EYE_HEIGHT };
      const minAlt = computeMinAlt(observer, target, localBuildings);
      const frac = fractionVisible(minAlt, targetHeight, shellRadius);
      const { lat, lng } = projector.toLatLng(x, y);

      features.push({
        type: "Feature",
        properties: { frac },
        geometry: { type: "Point", coordinates: [lng, lat] },
      });
    }
  }

  return { type: "FeatureCollection", features };
}

import { makeLocalProjector } from "@/lib/geo/toLocalMeters";
import { computeMinAlt } from "@/lib/viewshed/sightline";
import { fractionVisible } from "@/lib/viewshed/scoring";

const EYE_HEIGHT = 1.6;

/**
 * Polar grid of observer points radiating out from the launch point, each
 * scored for visibility fraction. Output is one Polygon (annular sector)
 * Feature per (ring, sector) cell rather than a Point — rendered as a `fill`
 * layer this reads as rays/rings radiating from the launch marker instead of
 * a scattered grid of dots, which is the point of sampling in polar (r, θ)
 * rather than Cartesian (x, y) in the first place.
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
 */
export function computeViewshed({
  launch,
  targetHeight,
  shellRadius,
  analysisRadius,
  radialSpacing = 20,
  angularSpacing = 6,
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

  const numRings = Math.floor(analysisRadius / radialSpacing);
  const numSectors = Math.round(360 / angularSpacing);
  const angleStep = (2 * Math.PI) / numSectors;

  const features = [];
  for (let ringIndex = 0; ringIndex < numRings; ringIndex++) {
    const rInner = ringIndex * radialSpacing;
    const rOuter = rInner + radialSpacing;
    const midR = (rInner + rOuter) / 2;

    for (let sectorIndex = 0; sectorIndex < numSectors; sectorIndex++) {
      const thetaInner = sectorIndex * angleStep;
      const thetaOuter = thetaInner + angleStep;
      const midTheta = thetaInner + angleStep / 2;

      const observer = { x: midR * Math.cos(midTheta), y: midR * Math.sin(midTheta), z: EYE_HEIGHT };
      const minAlt = computeMinAlt(observer, target, localBuildings);
      const frac = fractionVisible(minAlt, targetHeight, shellRadius);

      const corners = [
        [rInner * Math.cos(thetaInner), rInner * Math.sin(thetaInner)],
        [rOuter * Math.cos(thetaInner), rOuter * Math.sin(thetaInner)],
        [rOuter * Math.cos(thetaOuter), rOuter * Math.sin(thetaOuter)],
        [rInner * Math.cos(thetaOuter), rInner * Math.sin(thetaOuter)],
      ];
      const sectorRing = [...corners, corners[0]].map(([x, y]) => {
        const { lat, lng } = projector.toLatLng(x, y);
        return [lng, lat];
      });

      features.push({
        type: "Feature",
        properties: { frac },
        geometry: { type: "Polygon", coordinates: [sectorRing] },
      });
    }
  }

  return { type: "FeatureCollection", features };
}

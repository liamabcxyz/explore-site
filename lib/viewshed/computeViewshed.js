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
      const cellScore = compositeScore({
        minAlt,
        targetHeight,
        shellRadius,
        eyeHeight: EYE_HEIGHT,
        horizontalDistance: midR,
      });
      const heightDiff = targetHeight - EYE_HEIGHT;
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

      features.push({
        type: "Feature",
        properties: { frac, score: cellScore, category },
        geometry: { type: "Polygon", coordinates: [sectorRing] },
      });
    }
  }

  return { type: "FeatureCollection", features };
}

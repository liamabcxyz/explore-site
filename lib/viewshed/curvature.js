/**
 * Earth-curvature + standard atmospheric-refraction correction for long
 * sightlines. Short-range (the 1.5km viewshed grid) the drop is <0.2m and
 * is dominated by building-height uncertainty; it still runs there so the
 * profile math has one code path.
 *
 * Applied in the observer's local tangent plane: a point at ground range d
 * with orthometric height h sits at apparent altitude
 *
 *   h' = h − d² / (2 · k · R)
 *
 * with k ≈ 1.13 (optical, between 1 and the radio 4/3). Distant obstacles
 * AND the target both drop; because drop grows with d² the chord to the
 * target sinks faster than a mid-path obstacle, so net occlusion is more
 * pessimistic than a flat-earth model — see the design note on 自由放置观察点.
 *
 * Sign and formula match the standard surveying "hidden height" term.
 */

export const REFRACTION_K = 1.13;
export const EARTH_RADIUS_M = 6_371_000;

export function curvatureDrop(distanceMeters, k = REFRACTION_K) {
  if (!(distanceMeters > 0)) return 0;
  return (distanceMeters * distanceMeters) / (2 * k * EARTH_RADIUS_M);
}

export function apparentAltitude(orthometricMeters, distanceMeters, k = REFRACTION_K) {
  return orthometricMeters - curvatureDrop(distanceMeters, k);
}

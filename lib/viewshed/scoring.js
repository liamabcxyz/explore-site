/**
 * Geometrically exact fraction of the shell's disk that sits above the
 * nearest obstruction — not a linear ramp between "fully clear" and "fully
 * blocked". The shell is a circle of radius R centered at the target height;
 * an obstruction at altitude `minAlt` clips it with a horizontal line, and
 * the visible fraction is the area of the circular segment above that line
 * divided by the full disk (see 烟花可视性数学模型.md §3.2 for the derivation).
 * k = (minAlt - targetHeight) / R is that cut line in units of R from the
 * disk's center; f(k) = [arccos(k) - k·√(1-k²)] / π. Both this and the old
 * linear approximation agree at k=0 (a cut through the center is always
 * "half visible" by symmetry) but diverge everywhere else — e.g. k=0.5 is
 * 0.25 under the old linear ramp vs. ≈0.196 here.
 */
export function fractionVisible(minAlt, targetHeight, shellRadius) {
  const k = (minAlt - targetHeight) / shellRadius;
  if (k <= -1) return 1;
  if (k >= 1) return 0;
  return (Math.acos(k) - k * Math.sqrt(1 - k * k)) / Math.PI;
}

// Canonical source for this constant — computeViewshed.js/computeProfile.js
// import it from here instead of each redeclaring 1.6.
export const EYE_HEIGHT = 1.6;

export function elevationAngleDeg(horizontalDistance, heightDiff) {
  return Math.atan2(heightDiff, horizontalDistance) * (180 / Math.PI);
}

export function apparentAngularDiameterDeg(horizontalDistance, heightDiff, shellRadius) {
  const slantDistance = Math.hypot(horizontalDistance, heightDiff);
  return 2 * Math.atan(shellRadius / slantDistance) * (180 / Math.PI);
}

// Provisional — 烟花可视性数学模型.md §4.1 only states a qualitative ~0.3°-0.5°
// angular-size threshold below which a shell reads as an indistinct dot, not a
// function. This logistic (midpoint 0.4°, spanning ~10%->90% across that
// 0.2°-wide band) is a first-pass guess pending real calibration data, same
// as lib/geo/normalizeBuilding.js's HEIGHT_SOURCE_CONFIDENCE table.
const THETA_MIN_DEG = 0.4;
const THETA_STEEPNESS = 22;
export function angularSizeGate(thetaDeg) {
  return 1 / (1 + Math.exp(-THETA_STEEPNESS * (thetaDeg - THETA_MIN_DEG)));
}

// Provisional — the doc states both "~10°-35° sweet spot" and "penalize
// <15°/>45°" without reconciling them. Resolved here by treating 15°/45° as
// the hard ramp bounds and starting the low ramp at 5° so 10° lands at
// exactly 0.5 credit rather than fully in or out of the sweet spot.
const PHI_LOW_ZERO = 5;
const PHI_LOW_FULL = 15;
const PHI_HIGH_FULL = 35;
const PHI_HIGH_ZERO = 45;

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function elevationScore(phiDeg) {
  if (phiDeg <= PHI_LOW_ZERO) return 0;
  if (phiDeg < PHI_LOW_FULL) return smoothstep(PHI_LOW_ZERO, PHI_LOW_FULL, phiDeg);
  if (phiDeg <= PHI_HIGH_FULL) return 1;
  if (phiDeg < PHI_HIGH_ZERO) return 1 - smoothstep(PHI_HIGH_FULL, PHI_HIGH_ZERO, phiDeg);
  return 0;
}

/**
 * Q(o) = C(o)·W(o)·G(θ)·[E(φ) + ...] (烟花可视性数学模型.md §7), with the
 * bracket currently just E(φ): openness/Ω(o) has no formula in either doc
 * yet, so its term is omitted entirely rather than multiplied by a zero
 * weight (which would be dead, untestable code). `weather` defaults to 1
 * (no attenuation) — real Koschmieder-law attenuation is a P1 item, see
 * todo.md; this parameter exists so wiring it in later needs no restructuring.
 */
export function score({ minAlt, targetHeight, shellRadius, eyeHeight, horizontalDistance, weather = 1 }) {
  const heightDiff = targetHeight - eyeHeight;
  const frac = fractionVisible(minAlt, targetHeight, shellRadius);
  const theta = apparentAngularDiameterDeg(horizontalDistance, heightDiff, shellRadius);
  const phi = elevationAngleDeg(horizontalDistance, heightDiff);
  return frac * weather * angularSizeGate(theta) * elevationScore(phi);
}

export function openness() {
  throw new Error("openness: not implemented — no formula yet, deferred");
}

// How pleasant the viewing angle/apparent size is, independent of whether
// anything physically blocks the shot — the two halves of `score` that
// aren't `frac`. Kept as its own function (rather than inlined into `score`)
// because the map needs it separately: coloring by `score` alone conflates
// "a building is in the way" with "nothing's in the way but you're standing
// too close" — both collapse to red, which is exactly the bug this and
// `visibilityCategory` below exist to fix. `weather` isn't folded in here —
// when P1 lands, atmospheric haze reduces what you can *actually* see
// (an occlusion-like effect), not how pleasant the angle is, so it belongs
// with `frac` in a future "effective visibility" term, not here.
export function comfortFactor(thetaDeg, phiDeg) {
  return angularSizeGate(thetaDeg) * elevationScore(phiDeg);
}

// Provisional thresholds, first-pass guesses like the gate/score shapes
// above. Ordering matters: a genuinely blocked view is reported as blocked
// regardless of how good the angle would have been, since that's the more
// dominant fact.
const BLOCKED_FRAC_THRESHOLD = 0.15;
const COMFORT_THRESHOLD = 0.5;
const PARTIAL_FRAC_THRESHOLD = 0.85;

/**
 * Four mutually-exclusive categories a viewing point can fall into, meant to
 * be rendered as genuinely different colors rather than points on one
 * red-green ramp:
 *  - "blocked": a building is actually in the way — nothing to do with angle.
 *  - "poor-angle": nothing blocks the view, but it's standing too close (or
 *    too far) to be a comfortable/meaningful shot.
 *  - "partial": comfortable angle, but only part of the shell clears.
 *  - "good": comfortable angle and (mostly) unobstructed.
 */
export function visibilityCategory(frac, comfort) {
  if (frac < BLOCKED_FRAC_THRESHOLD) return "blocked";
  if (comfort < COMFORT_THRESHOLD) return "poor-angle";
  if (frac < PARTIAL_FRAC_THRESHOLD) return "partial";
  return "good";
}

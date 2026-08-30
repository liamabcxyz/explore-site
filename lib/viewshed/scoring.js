/**
 * frac = 55% of `score` (see tech design doc §3.4); the other three terms are
 * stubbed until ranking/candidate-point UI exists to validate them against —
 * `openness` in particular has no precise formula in the product doc yet.
 */

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

export function angleScore() {
  throw new Error("angleScore: not implemented — deferred with ranking UI");
}

export function distScore() {
  throw new Error("distScore: not implemented — deferred with ranking UI");
}

export function openness() {
  throw new Error("openness: not implemented — deferred with ranking UI");
}

export function score() {
  throw new Error("score: not implemented — deferred with ranking UI");
}

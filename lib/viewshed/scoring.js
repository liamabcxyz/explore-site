/**
 * frac = 55% of `score` (see tech design doc §3.4); the other three terms are
 * stubbed until ranking/candidate-point UI exists to validate them against —
 * `openness` in particular has no precise formula in the product doc yet.
 */

export function fractionVisible(minAlt, targetHeight, shellRadius) {
  const lower = targetHeight - shellRadius;
  const upper = targetHeight + shellRadius;
  if (minAlt <= lower) return 1;
  if (minAlt >= upper) return 0;
  return 1 - (minAlt - lower) / (upper - lower);
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

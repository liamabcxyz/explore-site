import { fractionVisible, angleScore, distScore, openness, score } from "@/lib/viewshed/scoring";

describe("fractionVisible", () => {
  const H = 100;
  const R = 20;

  it("is fully visible (1) at and below H - R", () => {
    expect(fractionVisible(H - R, H, R)).toBe(1);
    expect(fractionVisible(H - R - 50, H, R)).toBe(1);
    expect(fractionVisible(-Infinity, H, R)).toBe(1);
  });

  it("is fully blocked (0) at and above H + R", () => {
    expect(fractionVisible(H + R, H, R)).toBe(0);
    expect(fractionVisible(H + R + 50, H, R)).toBe(0);
  });

  it("is exactly half when the obstruction cuts through the shell's center (k=0)", () => {
    // A cut through the disk's center always bisects it by symmetry,
    // regardless of the exact shape of f(k) — this point doesn't distinguish
    // the geometric formula from a linear one, unlike the case below.
    expect(fractionVisible(H, H, R)).toBeCloseTo(0.5);
  });

  it("matches the exact circular-segment area at an arbitrary cut point", () => {
    // minAlt = H - R/2 -> k = -0.5
    // f(k) = [arccos(-0.5) - (-0.5)*sqrt(1-0.25)] / pi
    //      = [2.094395 + 0.433013] / pi ≈ 0.804499
    // (a linear ramp between H-R and H+R would instead give 0.75 here —
    // the two models diverge everywhere except k=0 and the ±1 boundaries)
    expect(fractionVisible(H - R / 2, H, R)).toBeCloseTo(0.804499, 5);
  });
});

describe("stubbed ranking-only formulas (deferred, not yet designed)", () => {
  it.each([
    ["angleScore", angleScore],
    ["distScore", distScore],
    ["openness", openness],
    ["score", score],
  ])("%s throws rather than silently returning a guessed value", (_name, fn) => {
    expect(() => fn()).toThrow();
  });
});

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

  it("interpolates linearly at the midpoint", () => {
    expect(fractionVisible(H, H, R)).toBeCloseTo(0.5);
  });

  it("interpolates linearly at an arbitrary point in between", () => {
    // 1/4 of the way from H-R to H+R -> frac should be 3/4
    expect(fractionVisible(H - R + (2 * R) / 4, H, R)).toBeCloseTo(0.75);
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

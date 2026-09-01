import { curvatureDrop, apparentAltitude, REFRACTION_K, EARTH_RADIUS_M } from "@/lib/viewshed/curvature";

describe("curvatureDrop", () => {
  it("is 0 at the observer", () => {
    expect(curvatureDrop(0)).toBe(0);
    expect(curvatureDrop(-10)).toBe(0);
  });

  it("matches the surveying table at 20km with k=1.13", () => {
    // d² / (2 k R) = 4e8 / (2 * 1.13 * 6371000) ≈ 27.8m
    expect(curvatureDrop(20_000)).toBeCloseTo(27.8, 0);
  });

  it("is ~31m at 20km without refraction (k=1)", () => {
    expect(curvatureDrop(20_000, 1)).toBeCloseTo((20_000 ** 2) / (2 * EARTH_RADIUS_M), 6);
  });

  it("apparentAltitude subtracts the drop", () => {
    const h = 100;
    expect(apparentAltitude(h, 10_000)).toBeCloseTo(h - curvatureDrop(10_000), 10);
    expect(REFRACTION_K).toBe(1.13);
  });
});

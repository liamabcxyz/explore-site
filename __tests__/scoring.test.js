import {
  fractionVisible,
  elevationAngleDeg,
  apparentAngularDiameterDeg,
  angularSizeGate,
  elevationScore,
  comfortFactor,
  visibilityCategory,
  isBlocked,
  score,
  openness,
} from "@/lib/viewshed/scoring";

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

describe("elevationAngleDeg / apparentAngularDiameterDeg", () => {
  it("computes elevation angle via atan2(heightDiff, horizontalDistance)", () => {
    expect(elevationAngleDeg(100, 98.4)).toBeCloseTo((Math.atan2(98.4, 100) * 180) / Math.PI, 6);
    expect(elevationAngleDeg(100, 98.4)).toBeCloseTo(44.5379, 3);
  });

  it("computes angular diameter from the slant distance, not the horizontal one", () => {
    const slant = Math.hypot(100, 98.4);
    expect(apparentAngularDiameterDeg(100, 98.4, 20)).toBeCloseTo(
      (2 * Math.atan(20 / slant) * 180) / Math.PI,
      6
    );
    expect(apparentAngularDiameterDeg(100, 98.4, 20)).toBeCloseTo(16.2265, 3);
  });
});

describe("angularSizeGate", () => {
  // Provisional logistic, midpoint 0.4°, steepness 22/deg — hardcoded here
  // independently of the implementation's constants, per this file's
  // existing "derive expectations separately" convention.
  it.each([
    [0.3, 1 / (1 + Math.exp(-22 * (0.3 - 0.4)))],
    [0.4, 0.5],
    [0.5, 1 / (1 + Math.exp(-22 * (0.5 - 0.4)))],
  ])("theta=%s° -> gate≈%s", (thetaDeg, expected) => {
    expect(angularSizeGate(thetaDeg)).toBeCloseTo(expected, 6);
  });

  it("saturates near 1 well above the ~0.3-0.5° threshold band", () => {
    expect(angularSizeGate(2.0)).toBeGreaterThan(0.9999);
  });

  it("saturates near 0 well below the threshold band", () => {
    expect(angularSizeGate(0)).toBeLessThan(0.001);
  });
});

describe("elevationScore", () => {
  function expectedSmoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  it("is 0 at and below the low cutoff (5°)", () => {
    expect(elevationScore(5)).toBe(0);
    expect(elevationScore(0)).toBe(0);
  });

  it("ramps up through the low band (5°-15°), landing at 0.5 credit at 10°", () => {
    expect(elevationScore(10)).toBeCloseTo(expectedSmoothstep(5, 15, 10), 6);
    expect(elevationScore(10)).toBeCloseTo(0.5, 6);
  });

  it("is 1 across the full sweet spot (15°-35°)", () => {
    expect(elevationScore(15)).toBe(1);
    expect(elevationScore(25)).toBe(1);
    expect(elevationScore(35)).toBe(1);
  });

  it("ramps down through the high band (35°-45°), landing at 0.5 credit at 40°", () => {
    expect(elevationScore(40)).toBeCloseTo(1 - expectedSmoothstep(35, 45, 40), 6);
    expect(elevationScore(40)).toBeCloseTo(0.5, 6);
  });

  it("is 0 at and above the high cutoff (45°)", () => {
    expect(elevationScore(45)).toBe(0);
    expect(elevationScore(60)).toBe(0);
  });
});

describe("comfortFactor", () => {
  it("is the product of the angular-size gate and the elevation score", () => {
    expect(comfortFactor(16.2265, 44.5379)).toBeCloseTo(
      angularSizeGate(16.2265) * elevationScore(44.5379),
      10
    );
  });

  it("is 0 when the elevation angle is outside the sweet spot even if angular size is fine", () => {
    expect(comfortFactor(20, 60)).toBe(0);
  });
});

describe("visibilityCategory", () => {
  // These four cases are the whole point of this function: a fully clear
  // sightline at a bad angle (frac=1, comfort=0) must NOT collapse to the
  // same category as a genuinely building-blocked point (frac=0) — both used
  // to render as identical red under score-only coloring.
  it("is 'blocked' when frac is low, regardless of comfort", () => {
    expect(visibilityCategory(0, 1)).toBe("blocked");
    expect(visibilityCategory(0.1, 1)).toBe("blocked");
  });

  it("is 'poor-angle' when the view is unobstructed but uncomfortable", () => {
    expect(visibilityCategory(1, 0)).toBe("poor-angle");
    expect(visibilityCategory(1, 0.49)).toBe("poor-angle");
  });

  it("is 'partial' when the angle is comfortable but occlusion is incomplete", () => {
    expect(visibilityCategory(0.5, 1)).toBe("partial");
  });

  it("is 'good' when comfortable and mostly/fully unobstructed", () => {
    expect(visibilityCategory(1, 1)).toBe("good");
    expect(visibilityCategory(0.9, 0.5)).toBe("good");
  });

  it("prioritizes 'blocked' over comfort at the boundary", () => {
    // A physically blocked point is reported as blocked even at a perfect angle.
    expect(visibilityCategory(0.14, 1)).toBe("blocked");
  });
});

describe("isBlocked", () => {
  // Same threshold visibilityCategory uses internally — kept in sync by
  // construction since both read BLOCKED_FRAC_THRESHOLD, not by asserting
  // the literal 0.15 here (that'd just be a second copy to drift out of sync).
  it("agrees with visibilityCategory's own blocked/not-blocked line", () => {
    expect(isBlocked(0.1)).toBe(true);
    expect(visibilityCategory(0.1, 1)).toBe("blocked");
    expect(isBlocked(0.5)).toBe(false);
    expect(visibilityCategory(0.5, 1)).not.toBe("blocked");
  });
});

describe("score", () => {
  const targetHeight = 100;
  const shellRadius = 20;
  const eyeHeight = 1.6;

  it("penalizes a steep, close-in viewing angle even when nothing occludes the view", () => {
    // 100m away: fully clear (frac=1), angular size saturated (gate≈1), but
    // elevation angle ≈44.5° sits deep in the high-side falloff — score
    // should track elevationScore almost exactly.
    const result = score({
      minAlt: -Infinity,
      targetHeight,
      shellRadius,
      eyeHeight,
      horizontalDistance: 100,
    });
    expect(result).toBeCloseTo(0.0062075, 5);
  });

  it("scores ≈1 at a clean sweet-spot distance with nothing occluding", () => {
    const result = score({
      minAlt: -Infinity,
      targetHeight,
      shellRadius,
      eyeHeight,
      horizontalDistance: 250,
    });
    expect(result).toBeCloseTo(1, 5);
  });

  it("multiplies all three non-trivial factors together for a partial-occlusion case", () => {
    const result = score({
      minAlt: 90,
      targetHeight,
      shellRadius,
      eyeHeight,
      horizontalDistance: 120,
    });
    expect(result).toBeCloseTo(0.4800383, 5);
  });

  it("defaults weather to 1 (no attenuation) when not provided", () => {
    const withoutWeather = score({ minAlt: -Infinity, targetHeight, shellRadius, eyeHeight, horizontalDistance: 250 });
    const withWeather = score({ minAlt: -Infinity, targetHeight, shellRadius, eyeHeight, horizontalDistance: 250, weather: 1 });
    expect(withoutWeather).toBe(withWeather);
  });

  it("applies weather as a direct multiplier", () => {
    const full = score({ minAlt: -Infinity, targetHeight, shellRadius, eyeHeight, horizontalDistance: 250, weather: 1 });
    const hazy = score({ minAlt: -Infinity, targetHeight, shellRadius, eyeHeight, horizontalDistance: 250, weather: 0.5 });
    expect(hazy).toBeCloseTo(full * 0.5, 6);
  });
});

describe("openness (deferred, no formula yet)", () => {
  it("throws rather than silently returning a guessed value", () => {
    expect(() => openness()).toThrow();
  });
});

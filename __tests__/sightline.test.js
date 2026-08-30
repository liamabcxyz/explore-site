import { intersectSegmentBuilding, computeMinAlt } from "@/lib/viewshed/sightline";

// observer at ground level, target 100m away and 100m up — a clean sightline
// along the x-axis so hand-computed t-values line up with x-coordinates.
const observer = { x: 0, y: 0, z: 0 };
const target = { x: 100, y: 0, z: 100 };

function squareBuilding(xMin, xMax, height) {
  return {
    height,
    footprint: [[
      { x: xMin, y: -10 },
      { x: xMax, y: -10 },
      { x: xMax, y: 10 },
      { x: xMin, y: 10 },
      { x: xMin, y: -10 },
    ]],
  };
}

describe("intersectSegmentBuilding", () => {
  it("computes tEntry/tExit and req for a building straddling the sightline", () => {
    const building = squareBuilding(45, 55, 51);
    const hit = intersectSegmentBuilding(observer, target, building);
    expect(hit.tEntry).toBeCloseTo(0.45);
    expect(hit.tExit).toBeCloseTo(0.55);
    // req = z0 + (height - z0) / tEntry = 0 + 51 / 0.45
    expect(hit.req).toBeCloseTo(51 / 0.45);
  });

  it("returns null when the building's footprint never crosses the sightline", () => {
    const offToTheSide = squareBuilding(45, 55, 51);
    offToTheSide.footprint = [[
      { x: 45, y: 20 }, { x: 55, y: 20 }, { x: 55, y: 30 }, { x: 45, y: 30 }, { x: 45, y: 20 },
    ]];
    expect(intersectSegmentBuilding(observer, target, offToTheSide)).toBeNull();
  });

  it("returns null for a building sitting exactly on the observer (tEntry <= 0)", () => {
    const atObserver = squareBuilding(-5, 0, 20);
    expect(intersectSegmentBuilding(observer, target, atObserver)).toBeNull();
  });
});

describe("computeMinAlt", () => {
  it("is the max req across all intersecting buildings, regardless of input order", () => {
    const tall = squareBuilding(45, 55, 51); // req ≈ 113.33
    const short = squareBuilding(65, 75, 30); // req ≈ 46.15

    const forward = computeMinAlt(observer, target, [tall, short]);
    const reversed = computeMinAlt(observer, target, [short, tall]);

    expect(forward).toBeCloseTo(51 / 0.45);
    expect(reversed).toBeCloseTo(51 / 0.45);
  });

  it("returns -Infinity when nothing intersects (the 'fully clear' sentinel)", () => {
    const clearOfPath = squareBuilding(45, 55, 51);
    clearOfPath.footprint = [[
      { x: 45, y: 20 }, { x: 55, y: 20 }, { x: 55, y: 30 }, { x: 45, y: 30 }, { x: 45, y: 20 },
    ]];
    expect(computeMinAlt(observer, target, [clearOfPath])).toBe(-Infinity);
    expect(computeMinAlt(observer, target, [])).toBe(-Infinity);
  });
});

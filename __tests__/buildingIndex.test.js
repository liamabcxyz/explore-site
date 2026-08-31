import { buildBuildingIndex, queryBuildingIndex } from "@/lib/viewshed/buildingIndex";
import { computeMinAlt } from "@/lib/viewshed/sightline";

function squareAt(xMin, xMax, yMin, yMax, height) {
  const ring = [
    { x: xMin, y: yMin },
    { x: xMax, y: yMin },
    { x: xMax, y: yMax },
    { x: xMin, y: yMax },
    { x: xMin, y: yMin },
  ];
  return { footprint: [ring], height };
}

describe("buildBuildingIndex", () => {
  it("registers a building into every cell its bounding box overlaps", () => {
    // cellSize 50; x:[10,120] spans cells 0,1,2 (0-50,50-100,100-150),
    // y:[10,60] spans cells 0,1 (0-50,50-100).
    const big = squareAt(10, 120, 10, 60, 30);
    const index = buildBuildingIndex([big], 50);
    for (let cx = 0; cx <= 2; cx++) {
      for (let cy = 0; cy <= 1; cy++) {
        expect(index.buckets.get(`${cx},${cy}`)).toContain(big);
      }
    }
    expect(index.buckets.get("5,5")).toBeUndefined();
  });
});

describe("queryBuildingIndex", () => {
  it("returns buildings near the segment's actual path, not its full bounding rectangle", () => {
    // nearLine sits almost exactly on the y=x diagonal from the origin; a
    // naive bounding-box bucket query would ALSO catch offLine (it's inside
    // the [0,1000]x[0,1000] rectangle) even though it's nowhere near the
    // line itself — the whole point of walking the line's actual cells
    // instead of its bbox.
    const nearLine = squareAt(490, 510, 490, 510, 20);
    const offLine = squareAt(50, 70, 950, 970, 20);
    const index = buildBuildingIndex([nearLine, offLine], 50);
    const candidates = queryBuildingIndex(index, { x: 0, y: 0 }, { x: 1000, y: 1000 });
    expect(candidates).toContain(nearLine);
    expect(candidates).not.toContain(offLine);
  });

  it("matches brute-force computeMinAlt for a scattered fixture, including exact-diagonal queries", () => {
    // Exact 45-degree directions are the DDA's known corner-skip risk
    // (tMaxX === tMaxY) — several observers below sit exactly on a
    // diagonal to make sure that path is exercised, not just axis-aligned
    // ones.
    const buildings = [
      squareAt(90, 110, -10, 10, 30),
      squareAt(-60, -40, -60, -40, 80),
      squareAt(200, 260, 190, 250, 150),
      squareAt(-300, -280, 300, 320, 40),
      squareAt(400, 420, -420, -400, 60),
    ];
    const index = buildBuildingIndex(buildings, 50);
    const target = { x: 0, y: 0, z: 100 };

    const observers = [
      { x: 150, y: 0, z: 1.6 },
      { x: 0, y: 150, z: 1.6 },
      { x: 300, y: 300, z: 1.6 },
      { x: -300, y: -300, z: 1.6 },
      { x: -500, y: 500, z: 1.6 },
      { x: 500, y: -500, z: 1.6 },
      { x: 230, y: 220, z: 1.6 },
      { x: 1000, y: 1, z: 1.6 },
      { x: 1, y: 1000, z: 1.6 },
    ];

    for (const observer of observers) {
      const candidates = queryBuildingIndex(index, observer, target);
      const indexed = computeMinAlt(observer, target, candidates);
      const bruteForce = computeMinAlt(observer, target, buildings);
      expect(indexed).toBe(bruteForce);
    }
  });
});

import { computeSightlineProfile } from "@/lib/viewshed/computeProfile";

// launch (target) sits at the projector origin (0,0) so local meters convert
// to lng/lat by dividing by METERS_PER_DEGREE_LAT (cos(0) = 1, no distortion).
const METERS_PER_DEGREE = 111320;
const launch = { lat: 0, lng: 0 };
const toLngLat = (x, y) => [x / METERS_PER_DEGREE, y / METERS_PER_DEGREE];

// Observer 100m due "east" of launch, so the sightline runs along the x-axis
// and hand-computed t-values line up with x-coordinates, same trick as
// __tests__/sightline.test.js.
const observer = { lat: 0, lng: 100 / METERS_PER_DEGREE };

function squareBuilding(xMin, xMax, height, confidence = "high") {
  return {
    height,
    confidence,
    footprint: [[
      toLngLat(xMin, -10),
      toLngLat(xMax, -10),
      toLngLat(xMax, 10),
      toLngLat(xMin, 10),
      toLngLat(xMin, -10),
    ]],
  };
}

describe("computeSightlineProfile", () => {
  it("returns a fully-clear profile when nothing intersects", () => {
    const result = computeSightlineProfile({
      observer,
      launch,
      targetHeight: 100,
      shellRadius: 20,
      buildings: [],
    });
    expect(result.totalDistance).toBeCloseTo(100);
    expect(result.hits).toEqual([]);
    expect(result.minAlt).toBe(-Infinity);
    expect(result.frac).toBe(1);
    // Close-in and steep (heightDiff=98.4 over 100m -> ~44.5°) penalizes the
    // composite score even though the line of sight itself is fully clear —
    // this is elevationScore's high-side falloff doing its job, not a bug.
    // Crucially, this must categorize as "poor-angle", never "blocked" —
    // nothing is actually in the way here.
    expect(result.theta).toBeCloseTo(16.2265, 3);
    expect(result.phi).toBeCloseTo(44.5379, 3);
    expect(result.score).toBeCloseTo(0.0062075, 5);
    expect(result.category).toBe("poor-angle");
  });

  it("scores near 1 at a clean sweet-spot distance with nothing blocking", () => {
    const farObserver = { lat: 0, lng: 250 / METERS_PER_DEGREE };
    const result = computeSightlineProfile({
      observer: farObserver,
      launch,
      targetHeight: 100,
      shellRadius: 20,
      buildings: [],
    });
    expect(result.frac).toBe(1);
    expect(result.score).toBeCloseTo(result.frac, 5);
    expect(result.score).toBeCloseTo(1, 5);
    expect(result.category).toBe("good");
  });

  it("reports distance/req for a single blocking building", () => {
    // eye(1.6) -> target(100) over 100m; building spans x in [45,55], so the
    // near face (from the observer at x=100 moving toward x=0) is x=55,
    // tEntry = (100-55)/100 = 0.45 -> distance 45m from the observer.
    const building = squareBuilding(45, 55, 51, "medium");
    const result = computeSightlineProfile({
      observer,
      launch,
      targetHeight: 100,
      shellRadius: 20,
      buildings: [building],
    });

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].distance).toBeCloseTo(45);
    expect(result.hits[0].height).toBe(51);
    expect(result.hits[0].confidence).toBe("medium");
    // req = eyeHeight + (height - eyeHeight) / tEntry = 1.6 + 49.4 / 0.45
    const expectedReq = 1.6 + 49.4 / 0.45;
    expect(result.hits[0].req).toBeCloseTo(expectedReq);
    expect(result.minAlt).toBeCloseTo(expectedReq);
    // frac follows the geometric circular-segment formula (see scoring.js),
    // not a linear ramp between lower/upper — k = (minAlt - H) / R
    const k = (expectedReq - 100) / 20;
    const expectedFrac = (Math.acos(k) - k * Math.sqrt(1 - k * k)) / Math.PI;
    expect(result.frac).toBeCloseTo(expectedFrac);
  });

  it("sorts multiple hits by distance and takes the max req as minAlt", () => {
    const far = squareBuilding(45, 55, 51); // distance 45m, req ≈ 111.38
    const near = squareBuilding(70, 80, 30); // distance 20m, req = 1.6 + 28.4/0.2 = 143.6

    const result = computeSightlineProfile({
      observer,
      launch,
      targetHeight: 100,
      shellRadius: 100,
      buildings: [far, near],
    });

    expect(result.hits.map((h) => h.height)).toEqual([30, 51]); // near (20m) before far (45m)
    expect(result.hits[0].distance).toBeCloseTo(20);
    expect(result.hits[1].distance).toBeCloseTo(45);

    const nearReq = 1.6 + 28.4 / 0.2;
    expect(result.minAlt).toBeCloseTo(nearReq);
    // shellRadius 100 here, same geometric formula as above
    const k = (nearReq - 100) / 100;
    const expectedFrac = (Math.acos(k) - k * Math.sqrt(1 - k * k)) / Math.PI;
    expect(result.frac).toBeCloseTo(expectedFrac);
  });

  it("clears a building from an elevated observer that would fully block it at ground level", () => {
    // Same building (60m, spanning x in [45,55]) and the same observer XY —
    // only observerHeight changes, e.g. ground floor vs. standing on a
    // neighboring 65m rooftop. This is the "observer on a building" case:
    // computeSightlineProfile shouldn't silently assume ground level.
    const building = squareBuilding(45, 55, 60);

    const groundLevel = computeSightlineProfile({
      observer,
      launch,
      targetHeight: 100,
      shellRadius: 20,
      buildings: [building],
      // observerHeight omitted -> defaults to EYE_HEIGHT (ground)
    });
    // req = 1.6 + 58.4/0.45 = 131.38, past H+R=120 -> fully blocked
    expect(groundLevel.frac).toBe(0);
    expect(groundLevel.eyeHeight).toBeCloseTo(1.6);

    const elevated = computeSightlineProfile({
      observer,
      launch,
      targetHeight: 100,
      shellRadius: 20,
      buildings: [building],
      observerHeight: 65,
    });
    // req = 65 + (60-65)/0.45 = 53.89, well below H-R=80 -> fully clear
    expect(elevated.frac).toBe(1);
    expect(elevated.eyeHeight).toBe(65);
  });
});

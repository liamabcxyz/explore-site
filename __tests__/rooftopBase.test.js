import { findRooftopBase, findBuildingAt } from "@/lib/geo/rooftopBase";

function squareBuilding(lngMin, lngMax, latMin, latMax, height, confidence = "high") {
  return {
    height,
    confidence,
    footprint: [[
      [lngMin, latMin], [lngMax, latMin], [lngMax, latMax], [lngMin, latMax], [lngMin, latMin],
    ]],
  };
}

describe("findRooftopBase", () => {
  it("returns 0 when the point isn't on any building", () => {
    const building = squareBuilding(0, 10, 0, 10, 50);
    expect(findRooftopBase({ lat: 20, lng: 20 }, [building])).toBe(0);
  });

  it("returns 0 with no buildings at all", () => {
    expect(findRooftopBase({ lat: 5, lng: 5 }, [])).toBe(0);
  });

  it("returns the building's height when the point falls inside its footprint", () => {
    const building = squareBuilding(0, 10, 0, 10, 50);
    expect(findRooftopBase({ lat: 5, lng: 5 }, [building])).toBe(50);
  });

  it("picks the tallest match when multiple footprints overlap the point", () => {
    // A tower's footprint sitting inside a wider, shorter podium's — both
    // contain the point, the tower's roof is the one you'd actually stand on.
    const podium = squareBuilding(0, 20, 0, 20, 15);
    const tower = squareBuilding(5, 15, 5, 15, 80);
    const point = { lat: 10, lng: 10 };
    expect(findRooftopBase(point, [podium, tower])).toBe(80);
    expect(findRooftopBase(point, [tower, podium])).toBe(80); // order-independent
  });

  it("ignores a building whose footprint the point sits just outside of", () => {
    const building = squareBuilding(0, 10, 0, 10, 50);
    expect(findRooftopBase({ lat: 5, lng: 10.001 }, [building])).toBe(0);
  });
});

describe("findBuildingAt", () => {
  it("returns null when the point isn't on any building", () => {
    const building = squareBuilding(0, 10, 0, 10, 50);
    expect(findBuildingAt({ lat: 20, lng: 20 }, [building])).toBeNull();
  });

  it("returns the height and confidence of the building the point falls inside", () => {
    const building = squareBuilding(0, 10, 0, 10, 50, "medium");
    expect(findBuildingAt({ lat: 5, lng: 5 }, [building])).toEqual({ height: 50, confidence: "medium" });
  });

  it("picks the tallest match's confidence too, same tie-break as findRooftopBase", () => {
    const podium = squareBuilding(0, 20, 0, 20, 15, "high");
    const tower = squareBuilding(5, 15, 5, 15, 80, "low");
    const point = { lat: 10, lng: 10 };
    expect(findBuildingAt(point, [podium, tower])).toEqual({ height: 80, confidence: "low" });
  });
});

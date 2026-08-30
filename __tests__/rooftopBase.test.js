import { findRooftopBase } from "@/lib/geo/rooftopBase";

function squareBuilding(lngMin, lngMax, latMin, latMax, height) {
  return {
    height,
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

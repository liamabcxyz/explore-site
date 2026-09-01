import { ElevationGrid, latLngToTileXY, tileXYToLatLng } from "@/lib/viewshed/ElevationGrid";

// A 2x2 grid centered near NYC — small enough to hand-derive expected
// bilinear values.
function fixture2x2({ v00 = 10, v10 = 20, v01 = 30, v11 = 40 } = {}) {
  return new ElevationGrid({
    data: new Float32Array([v00, v10, v01, v11]),
    cellsX: 2,
    cellsY: 2,
    northLat: 40.72,
    westLng: -74.01,
    latStepDeg: -0.01, // NW → SE: lat decreases 0.01° per pixel row
    lngStepDeg: 0.01,
  });
}

describe("ElevationGrid — pixel-center exact reads", () => {
  it("returns each corner's stored value when queried at the exact corner", () => {
    const g = fixture2x2();
    expect(g.getElevation(-74.01, 40.72)).toBeCloseTo(10, 6); // NW
    expect(g.getElevation(-74.00, 40.72)).toBeCloseTo(20, 6); // NE
    expect(g.getElevation(-74.01, 40.71)).toBeCloseTo(30, 6); // SW
    expect(g.getElevation(-74.00, 40.71)).toBeCloseTo(40, 6); // SE
  });
});

describe("ElevationGrid — bilinear interpolation", () => {
  it("returns the two-pixel mean at the exact midpoint of an edge", () => {
    // Midpoint of the north edge (lng between NW and NE, lat = north)
    // should be mean(v00, v10) = 15.
    const g = fixture2x2();
    expect(g.getElevation(-74.005, 40.72)).toBeCloseTo(15, 6);
    // Midpoint of the west edge should be mean(v00, v01) = 20.
    expect(g.getElevation(-74.01, 40.715)).toBeCloseTo(20, 6);
  });

  it("returns the four-corner mean at the exact center", () => {
    // (10 + 20 + 30 + 40) / 4 = 25
    const g = fixture2x2();
    expect(g.getElevation(-74.005, 40.715)).toBeCloseTo(25, 6);
  });

  it("gives the closed-form bilinear value at an off-center point", () => {
    // fx=0.25, fy=0.75 → (1-fx)*(1-fy)*v00 + fx*(1-fy)*v10 + (1-fx)*fy*v01 + fx*fy*v11
    // = 0.75*0.25*10 + 0.25*0.25*20 + 0.75*0.75*30 + 0.25*0.75*40
    // = 1.875 + 1.25 + 16.875 + 7.5 = 27.5
    const g = fixture2x2();
    // lng offset 0.25 pixels east of west edge, lat offset 0.75 pixels
    // south of north edge (i.e. 0.75% of the way from NW toward SE row-wise)
    expect(g.getElevation(-74.01 + 0.01 * 0.25, 40.72 + -0.01 * 0.75)).toBeCloseTo(27.5, 6);
  });
});

describe("ElevationGrid — coverage checks", () => {
  it("hasCoverage true for interior/boundary points, false outside", () => {
    const g = fixture2x2();
    expect(g.hasCoverage(-74.005, 40.715)).toBe(true); // interior
    expect(g.hasCoverage(-74.01, 40.72)).toBe(true);   // NW corner
    expect(g.hasCoverage(-74.00, 40.71)).toBe(true);   // SE corner
    expect(g.hasCoverage(-73.99, 40.71)).toBe(false);  // east of grid
    expect(g.hasCoverage(-74.02, 40.71)).toBe(false);  // west
    expect(g.hasCoverage(-74.00, 40.73)).toBe(false);  // north
    expect(g.hasCoverage(-74.00, 40.70)).toBe(false);  // south
  });

  it("getElevation returns null outside coverage rather than extrapolating", () => {
    // Extrapolating past the grid edge would give a plausible-looking
    // wrong answer; null forces the caller to notice they queried out of
    // bounds. Downstream (Phase 3) treats null as "no terrain data,
    // assume z=0" — clean surface for the fallback.
    const g = fixture2x2();
    expect(g.getElevation(-73.99, 40.71)).toBeNull();
    expect(g.getElevation(-74.02, 40.70)).toBeNull();
  });
});

describe("ElevationGrid.flat", () => {
  it("returns an all-zeros grid over the requested bbox", () => {
    // Purpose is the Phase 3 test-migration path (plan doc §6): passing
    // this into pre-terrain fixtures makes them numerically equivalent to
    // the pre-terrain code path (0m everywhere collapses "absolute
    // altitude" back to "relative altitude").
    const g = ElevationGrid.flat({
      westLng: -74.01, northLat: 40.72, eastLng: -74.00, southLat: 40.71,
    });
    expect(g.hasCoverage(-74.005, 40.715)).toBe(true);
    expect(g.getElevation(-74.005, 40.715)).toBe(0);
    expect(g.getElevation(-74.01, 40.72)).toBe(0);
  });
});

describe("latLngToTileXY / tileXYToLatLng — Web Mercator tile math", () => {
  it("puts (lat=0, lng=0) at the center of the world tile at zoom 0", () => {
    // Zoom 0 is a single 1x1 tile covering the world; (0,0) sits in
    // the middle → x=0.5, y=0.5.
    const { x, y } = latLngToTileXY(0, 0, 0);
    expect(x).toBeCloseTo(0.5, 6);
    expect(y).toBeCloseTo(0.5, 6);
  });

  it("round-trips latLng → tileXY → latLng within float precision", () => {
    // If either transform is wrong on its own, the round trip catches it
    // — no external reference values to bit-rot.
    const points = [
      { lat: 40.7128, lng: -74.006 },  // NYC
      { lat: 37.7749, lng: -122.4194 }, // SF
      { lat: -33.8688, lng: 151.2093 }, // Sydney
    ];
    for (const { lat, lng } of points) {
      const { x, y } = latLngToTileXY(lat, lng, 14);
      const back = tileXYToLatLng(x, y, 14);
      expect(back.lat).toBeCloseTo(lat, 10);
      expect(back.lng).toBeCloseTo(lng, 10);
    }
  });

  it("increasing longitude increases tile x, moving further south increases tile y", () => {
    // Sanity check on axis orientation — a swapped sign here would send
    // the loader to fetch tiles from the wrong hemisphere.
    const zoom = 14;
    const east = latLngToTileXY(40, -73, zoom);
    const west = latLngToTileXY(40, -75, zoom);
    expect(east.x).toBeGreaterThan(west.x);

    const north = latLngToTileXY(41, -74, zoom);
    const south = latLngToTileXY(39, -74, zoom);
    expect(south.y).toBeGreaterThan(north.y);
  });
});

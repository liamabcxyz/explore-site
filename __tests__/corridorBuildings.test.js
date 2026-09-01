import { BUILDING_TILE_ZOOM, CORRIDOR_BUFFER_METERS } from "@/lib/geo/corridorBuildings";

describe("corridorBuildings module", () => {
  it("loads (pmtiles + vector-tile + pbf resolve) and exposes the z14/200m constants", () => {
    expect(BUILDING_TILE_ZOOM).toBe(14);
    expect(CORRIDOR_BUFFER_METERS).toBe(200);
  });
});

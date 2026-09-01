import { tilesAlongCorridor, tileDistanceSpan } from "@/lib/viewshed/tileWalk";
import { latLngToTileXY } from "@/lib/viewshed/ElevationGrid";

const from = { lat: 37.7925, lng: -122.397 };
const toEast = { lat: 37.7925, lng: -122.18 }; // ~19km east at this lat

describe("tilesAlongCorridor", () => {
  it("returns the origin tile for a zero-length corridor", () => {
    const tiles = tilesAlongCorridor(from, from, 14, 200);
    expect(tiles).toHaveLength(1);
    const { x, y } = latLngToTileXY(from.lat, from.lng, 14);
    expect(tiles[0]).toEqual({ z: 14, x: Math.floor(x), y: Math.floor(y) });
  });

  it("walks a long east-west line without filling its bounding square", () => {
    const tiles = tilesAlongCorridor(from, toEast, 14, 200);
    const xs = tiles.map((t) => t.x);
    const ys = tiles.map((t) => t.y);
    const width = Math.max(...xs) - Math.min(...xs) + 1;
    const height = Math.max(...ys) - Math.min(...ys) + 1;
    // A ~19km line at z14 is ~10 tiles long, 1-3 tiles tall with a 200m buffer.
    // The AABB of that line would be ~10×10 if we had taken min/max lat/lng
    // of a diagonal; this one is due east so height stays small either way,
    // but tile count must stay linear in length, not quadratic.
    expect(tiles.length).toBeLessThan(40);
    expect(width).toBeGreaterThan(5);
    expect(height).toBeLessThan(5);
  });

  it("includes both endpoints", () => {
    const tiles = tilesAlongCorridor(from, toEast, 14, 0);
    const start = latLngToTileXY(from.lat, from.lng, 14);
    const end = latLngToTileXY(toEast.lat, toEast.lng, 14);
    expect(tiles).toEqual(expect.arrayContaining([
      { z: 14, x: Math.floor(start.x), y: Math.floor(start.y) },
      { z: 14, x: Math.floor(end.x), y: Math.floor(end.y) },
    ]));
  });
});

describe("tileDistanceSpan", () => {
  it("returns a span when the segment crosses the tile", () => {
    const { x, y } = latLngToTileXY(from.lat, from.lng, 14);
    const tile = { z: 14, x: Math.floor(x), y: Math.floor(y) };
    const span = tileDistanceSpan(tile, from, toEast, 14);
    expect(span).not.toBeNull();
    expect(span.fromMeters).toBe(0);
    expect(span.toMeters).toBeGreaterThan(0);
  });

  it("returns null when the tile is nowhere near the segment", () => {
    const span = tileDistanceSpan({ z: 14, x: 0, y: 0 }, from, toEast, 14);
    expect(span).toBeNull();
  });
});

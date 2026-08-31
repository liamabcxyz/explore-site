import { pickTopSpots } from "@/lib/viewshed/pickTopSpots";
import { makeLocalProjector } from "@/lib/geo/toLocalMeters";

const origin = { lat: 40.7128, lng: -74.006 };
const projector = makeLocalProjector(origin.lat, origin.lng);

// Build a fake "grid cell" feature from a local-meters coord + score.
function cellAt(xMeters, yMeters, score) {
  const { lat: sampleLat, lng: sampleLng } = projector.toLatLng(xMeters, yMeters);
  return { properties: { score, sampleLat, sampleLng } };
}

describe("pickTopSpots", () => {
  it("returns [] for an empty input", () => {
    expect(pickTopSpots([])).toEqual([]);
  });

  it("returns [] when no feature carries a positive score (e.g. all-blocked)", () => {
    // score=0 means the cell scored zero — not a real recommendation.
    // Filtering these out is what keeps "top spot" from ever pointing at
    // a spot with no view.
    const grid = [cellAt(0, 0, 0), cellAt(100, 0, 0)];
    expect(pickTopSpots(grid)).toEqual([]);
  });

  it("picks the highest-score cells when they're already well-separated", () => {
    const grid = [
      cellAt(0, 0, 0.5),
      cellAt(800, 0, 0.9), // #1
      cellAt(-800, 0, 0.7), // #2
      cellAt(0, 800, 0.6), // #3
    ];
    const spots = pickTopSpots(grid, 3, 300);
    expect(spots).toHaveLength(3);
    expect(spots.map((s) => s.rank)).toEqual([1, 2, 3]);
    // First pick is the highest-score cell, sanity check by comparing
    // approx local-meters distance from the origin (should be ~800m east).
    const { x: x1, y: y1 } = projector.toLocal(spots[0].lat, spots[0].lng);
    expect(Math.round(x1)).toBe(800);
    expect(Math.round(y1)).toBe(0);
  });

  it("skips lower-scored cells that sit within minSpreadMeters of an already-picked one", () => {
    // 3 cells clumped near (0,0), all with different scores — only the
    // highest-score one in the cluster should survive. A separate faraway
    // cell can then be #2 (even with a lower score).
    const grid = [
      cellAt(0, 0, 0.95),
      cellAt(50, 0, 0.9), // too close to #1, skipped
      cellAt(-50, 30, 0.85), // too close to #1, skipped
      cellAt(500, 500, 0.5), // far enough — becomes #2 despite lower score
    ];
    const spots = pickTopSpots(grid, 3, 300);
    expect(spots).toHaveLength(2);
    expect(spots.map((s) => s.score)).toEqual([0.95, 0.5]);
  });

  it("returns fewer than `count` when not enough well-separated spots exist", () => {
    // Every cell is clumped near origin — after picking #1, no candidate
    // meets the spread requirement.
    const grid = [
      cellAt(0, 0, 0.9),
      cellAt(50, 0, 0.8),
      cellAt(-30, 20, 0.7),
    ];
    expect(pickTopSpots(grid, 3, 300)).toHaveLength(1);
  });

  it("ignores features missing sampleLat/sampleLng — the pre-property change grid shape", () => {
    // Guards against a caller wiring up an old-shape grid without
    // sampleLat/sampleLng properties (would otherwise crash on toLocal).
    const grid = [
      { properties: { score: 0.9 } },
      cellAt(500, 500, 0.5),
    ];
    const spots = pickTopSpots(grid, 3, 300);
    expect(spots).toHaveLength(1);
    expect(spots[0].score).toBe(0.5);
  });
});

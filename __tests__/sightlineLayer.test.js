import { sightlineMapData } from "@/lib/viewshed/sightlineLayer";

const observer = { lat: 37.8, lng: -122.5 };
const launch = { lat: 37.8, lng: -122.4 };

describe("sightlineMapData", () => {
  it("returns empty collections when there is no profile", () => {
    const empty = sightlineMapData({ observer, launch, profile: null });
    expect(empty.lines.features).toHaveLength(0);
    expect(empty.blocker.features).toHaveLength(0);
  });

  it("draws one green line when the shell is fully visible", () => {
    const { lines, blocker } = sightlineMapData({
      observer,
      launch,
      profile: { totalDistance: 8000, frac: 1, hits: [] },
    });
    expect(lines.features).toHaveLength(1);
    expect(lines.features[0].properties.segment).toBe("clear");
    expect(blocker.features).toHaveLength(0);
  });

  it("splits at the max-req hit and outlines that building", () => {
    const footprint = [[[-122.45, 37.8], [-122.449, 37.8], [-122.449, 37.801], [-122.45, 37.801], [-122.45, 37.8]]];
    const { lines, blocker } = sightlineMapData({
      observer,
      launch,
      profile: {
        totalDistance: 1000,
        frac: 0,
        hits: [
          { distance: 400, req: 200, footprint, name: "Tower" },
          { distance: 100, req: 80, footprint: null },
        ],
      },
    });
    expect(lines.features.map((f) => f.properties.segment)).toEqual(["clear", "blocked"]);
    const split = lines.features[0].geometry.coordinates[1];
    // 400/1000 of the way from observer lng -122.5 to launch -122.4
    expect(split[0]).toBeCloseTo(-122.46, 5);
    expect(blocker.features).toHaveLength(1);
    expect(blocker.features[0].properties.name).toBe("Tower");
  });
});

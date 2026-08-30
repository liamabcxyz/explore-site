import { computeViewshed } from "@/lib/viewshed/computeViewshed";
import { makeLocalProjector } from "@/lib/geo/toLocalMeters";

const launch = { lat: 37.7925, lng: -122.397 };
const projector = makeLocalProjector(launch.lat, launch.lng);

function squareAt(xMin, xMax, yMin, yMax, height) {
  const corners = [
    [xMin, yMin], [xMax, yMin], [xMax, yMax], [xMin, yMax], [xMin, yMin],
  ].map(([x, y]) => {
    const { lat, lng } = projector.toLatLng(x, y);
    return [lng, lat];
  });
  return { footprint: [corners], base: 0, height };
}

describe("computeViewshed", () => {
  it("marks every sector fully visible when there are no buildings", () => {
    // 2 rings (0-50, 50-100) x 4 sectors (90° each)
    const result = computeViewshed({
      launch,
      targetHeight: 50,
      shellRadius: 10,
      analysisRadius: 100,
      radialSpacing: 50,
      angularSpacing: 90,
      buildings: [],
    });
    expect(result.features).toHaveLength(2 * 4);
    for (const f of result.features) {
      expect(f.properties.frac).toBe(1);
    }
  });

  it("marks exactly the sector a tall building sits in as blocked", () => {
    // angularSpacing 120 -> 3 sectors per ring, boundaries at 0/120/240°, so
    // sector index 1 (theta 120-240°) is centered on 180° — straight out
    // along -x from the launch point at the origin. Single ring (radialSpacing
    // == analysisRadius), midR = 25, so that sector's sample observer sits at
    // (-25, 0). A tall building straddling the segment from there to the
    // launch point blocks only this one sector; the sightlines to the other
    // two sectors' observers (at 60° and 300°, both on the +x side) never
    // cross negative x, so they stay clear.
    const building = squareAt(-15, -5, -5, 5, 200);
    const result = computeViewshed({
      launch,
      targetHeight: 50,
      shellRadius: 10,
      analysisRadius: 50,
      radialSpacing: 50,
      angularSpacing: 120,
      buildings: [building],
    });

    expect(result.features).toHaveLength(3);
    const blocked = result.features.filter((f) => f.properties.frac === 0);
    const clear = result.features.filter((f) => f.properties.frac === 1);
    expect(blocked).toHaveLength(1);
    expect(clear).toHaveLength(2);
    expect(blocked[0].properties.category).toBe("blocked");
    for (const f of clear) {
      expect(f.properties.category).not.toBe("blocked");
    }
  });

  it("categorizes a clear-but-badly-angled cell as 'poor-angle', not 'blocked'", () => {
    // Realistic scale (targetHeight 100 / eyeHeight 1.6, unlike the tight
    // 50m-radius fixtures above, which are too close-in for elevation angle
    // to mean anything — see notes.md). One sector per ring (angularSpacing
    // 360) isolates the radial (distance) effect. No buildings, so frac=1
    // everywhere; `score`/`category` should still vary because elevationScore
    // doesn't care about occlusion.
    // Ring 0 (midR=50): phi = atan(98.4/50) ≈ 63.1° — past the high cutoff
    // (45°), so comfort=0 and score=0 despite a fully clear line of sight.
    // This is exactly the case that used to render identically to an
    // actually-blocked cell under score-only coloring — it must land in
    // "poor-angle", never "blocked", since nothing physically obstructs it.
    // Rings 1/2 (midR=150, 250): phi ≈ 33.3°/21.5°, both inside the 15°-35°
    // sweet spot, and angular size is saturated at this distance — "good".
    const result = computeViewshed({
      launch,
      targetHeight: 100,
      shellRadius: 20,
      analysisRadius: 300,
      radialSpacing: 100,
      angularSpacing: 360,
      buildings: [],
    });

    expect(result.features).toHaveLength(3);
    const [ring0, ring1, ring2] = result.features;
    expect(ring0.properties.frac).toBe(1);
    expect(ring0.properties.score).toBe(0);
    expect(ring0.properties.category).toBe("poor-angle");
    expect(ring1.properties.frac).toBe(1);
    expect(ring1.properties.score).toBeCloseTo(1, 6);
    expect(ring1.properties.category).toBe("good");
    expect(ring2.properties.frac).toBe(1);
    expect(ring2.properties.score).toBeCloseTo(1, 6);
    expect(ring2.properties.category).toBe("good");
  });

  it("returns a Polygon FeatureCollection with a closed ring per sector", () => {
    const result = computeViewshed({
      launch,
      targetHeight: 50,
      shellRadius: 10,
      analysisRadius: 50,
      radialSpacing: 50,
      angularSpacing: 90,
      buildings: [],
    });
    expect(result.type).toBe("FeatureCollection");
    for (const f of result.features) {
      expect(f.type).toBe("Feature");
      expect(f.geometry.type).toBe("Polygon");
      const ring = f.geometry.coordinates[0];
      expect(ring).toHaveLength(5); // 4 corners + closing point
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      expect(typeof f.properties.frac).toBe("number");
      expect(typeof f.properties.score).toBe("number");
      expect(["blocked", "poor-angle", "partial", "good"]).toContain(f.properties.category);
    }
  });
});

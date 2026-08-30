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
    }
  });
});

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

function findCell(result, x, y) {
  const { lat, lng } = projector.toLatLng(x, y);
  return result.features.find(
    (f) =>
      Math.abs(f.geometry.coordinates[0] - lng) < 1e-9 &&
      Math.abs(f.geometry.coordinates[1] - lat) < 1e-9
  );
}

describe("computeViewshed", () => {
  it("marks a grid point directly behind a tall building as fully blocked", () => {
    // Observer grid point at (-50, 0); building straddles the line to the
    // launch point at the local origin (0, 0).
    const building = squareAt(-30, -20, -5, 5, 200);
    const result = computeViewshed({
      launch,
      targetHeight: 50,
      shellRadius: 10,
      analysisRadius: 100,
      gridSpacing: 50,
      buildings: [building],
    });

    const cell = findCell(result, -50, 0);
    expect(cell).toBeDefined();
    expect(cell.properties.frac).toBe(0);
  });

  it("marks every grid point fully visible when there are no buildings", () => {
    const result = computeViewshed({
      launch,
      targetHeight: 50,
      shellRadius: 10,
      analysisRadius: 100,
      gridSpacing: 50,
      buildings: [],
    });
    expect(result.features.length).toBeGreaterThan(0);
    for (const f of result.features) {
      expect(f.properties.frac).toBe(1);
    }
  });

  it("returns a Point FeatureCollection", () => {
    const result = computeViewshed({
      launch,
      targetHeight: 50,
      shellRadius: 10,
      analysisRadius: 50,
      gridSpacing: 50,
      buildings: [],
    });
    expect(result.type).toBe("FeatureCollection");
    for (const f of result.features) {
      expect(f.type).toBe("Feature");
      expect(f.geometry.type).toBe("Point");
      expect(typeof f.properties.frac).toBe("number");
    }
  });
});

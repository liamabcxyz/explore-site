import { computeRooftopLayer } from "@/lib/viewshed/computeRooftopLayer";
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

describe("computeRooftopLayer", () => {
  it("returns one feature per building, using each building's own footprint as geometry", () => {
    const a = squareAt(90, 110, -10, 10, 30);
    const b = squareAt(40, 60, -10, 10, 200);
    const result = computeRooftopLayer({
      launch,
      targetHeight: 100,
      shellRadius: 20,
      buildings: [a, b],
    });

    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toHaveLength(2);
    expect(result.features[0].geometry).toEqual({ type: "Polygon", coordinates: a.footprint });
    expect(result.features[1].geometry).toEqual({ type: "Polygon", coordinates: b.footprint });
    expect(result.features[0].properties.buildingHeight).toBe(30);
    expect(result.features[1].properties.buildingHeight).toBe(200);
  });

  it("doesn't self-occlude — an isolated building sees the launch clearly from its own roof", () => {
    // Centroid at (100, 0); observer sits there at height 30+1.6=31.6.
    // The building's own footprint (x in [90,110]) only crosses the segment
    // to the launch point at x=90 (one edge, t=0.1) — the x=110 edge is
    // behind the observer (t<0) and never counted, so intersectSegmentBuilding
    // never gets the two crossings it needs to register a hit on itself.
    const a = squareAt(90, 110, -10, 10, 30);
    const result = computeRooftopLayer({
      launch,
      targetHeight: 100,
      shellRadius: 20,
      buildings: [a],
    });
    expect(result.features[0].properties.frac).toBe(1);
  });

  it("is blocked by a taller building between its roof and the launch point", () => {
    // a's observer stands at (100, 0, 31.6). b (200m tall) spans x in
    // [40,60], between a's observer and the launch at the origin.
    // tEntry (from a's observer at x=100 toward x=0) hits b's near face at
    // x=60 -> tEntry = (100-60)/100 = 0.4.
    const a = squareAt(90, 110, -10, 10, 30);
    const b = squareAt(40, 60, -10, 10, 200);
    const result = computeRooftopLayer({
      launch,
      targetHeight: 50,
      shellRadius: 10,
      buildings: [a, b],
    });

    // req = 31.6 + (200-31.6)/0.4 = 452.6 -> k=(452.6-50)/10=40.26 >= 1 -> frac 0
    expect(result.features[0].properties.frac).toBe(0);
    expect(result.features[0].properties.category).toBe("blocked");

    // b's own rooftop view: nothing sits between its centroid (x=50) and
    // the launch (x=0) — a is on the far side (x in [90,110]) — so b reads
    // fully clear from its own roof.
    expect(result.features[1].properties.frac).toBe(1);
  });

  describe("large buildings: 'mixed' when corner samples disagree with the centroid", () => {
    // a spans x:[100,160], y:[-30,30] — a 60x60 footprint, bbox diagonal
    // ≈84.9m, past LARGE_BUILDING_EXTENT_METERS (40) — so its own corners
    // (100,-30)/(160,-30)/(160,30)/(100,30) get sampled in addition to its
    // centroid (130,0). b sits off the centroid's straight-line path to the
    // launch (the x-axis, y=0) but squarely on the diagonal from corner
    // (100,-30) to the launch at the origin (that line is y=-0.3x; at
    // b's x-span [40,60] it's y in [-18,-12], inside b's y-span [-25,-5]) —
    // so the centroid reads clear while that one corner reads blocked.
    const a = squareAt(100, 160, -30, 30, 30);
    const b = squareAt(40, 60, -25, -5, 200);

    it("marks the whole building 'mixed' rather than trusting the centroid alone", () => {
      const result = computeRooftopLayer({
        launch,
        targetHeight: 50,
        shellRadius: 10,
        buildings: [a, b],
      });
      expect(result.features[0].properties.category).toBe("mixed");
      // Geometry stays the building's real, unsplit footprint — "mixed" is
      // just a different value in the same per-building feature, not a
      // reason to change what gets rendered.
      expect(result.features[0].geometry).toEqual({ type: "Polygon", coordinates: a.footprint });
      expect(result.features[0].properties.buildingHeight).toBe(30);
    });

    it("leaves a small building's single-centroid category alone under the identical occluder", () => {
      // Same centroid (130,0), same occluder b — only a's own footprint
      // shrinks to 20x20 (diagonal ≈28.3m, under the 40m gate), so it never
      // gets the extra corner samples that would otherwise disagree.
      const small = squareAt(120, 140, -10, 10, 30);
      const result = computeRooftopLayer({
        launch,
        targetHeight: 50,
        shellRadius: 10,
        buildings: [small, b],
      });
      expect(result.features[0].properties.category).not.toBe("mixed");
    });

    it("doesn't flag a large, isolated building as 'mixed' when every sample agrees", () => {
      // No occluder at all — centroid and all 4 corners of this 80x80
      // footprint (diagonal ≈113m, well past the gate) read fully clear.
      const isolated = squareAt(100, 180, -40, 40, 30);
      const result = computeRooftopLayer({
        launch,
        targetHeight: 50,
        shellRadius: 10,
        buildings: [isolated],
      });
      expect(result.features[0].properties.category).not.toBe("mixed");
      expect(result.features[0].properties.frac).toBe(1);
    });
  });
});

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
});

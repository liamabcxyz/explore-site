import {
  unpackViewshedGrid,
  unpackRooftopLayer,
} from "@/lib/viewshed/wasmUnmarshaling";

describe("unpackViewshedGrid", () => {
  const launch = { lat: 40.7, lng: -74.0 };
  const analysisRadius = 200;
  const radialSpacing = 50; // → 4 rings
  const angularSpacing = 60; // → 6 sectors

  // A flat with 6 sectors × 4 rings = 24 cells → length 1 + 3*24 = 73.
  // Values are set so each cell has a distinct frac / score / category
  // triple; category codes are cycled 0..3 to exercise the string map.
  function buildFlat() {
    const numRings = 4;
    const numSectors = 6;
    const out = new Float64Array(1 + 3 * numRings * numSectors);
    out[0] = 7.5; // avgCandidates
    for (let s = 0; s < numSectors; s++) {
      for (let r = 0; r < numRings; r++) {
        const cellIdx = s * numRings + r;
        const off = 1 + 3 * cellIdx;
        out[off] = 0.1 * (cellIdx + 1);          // frac
        out[off + 1] = 0.05 * (cellIdx + 1);     // score
        out[off + 2] = cellIdx % 4;              // category code
      }
    }
    return out;
  }

  it("returns a FeatureCollection with the expected feature count", () => {
    const flat = buildFlat();
    const fc = unpackViewshedGrid(flat, launch, analysisRadius, radialSpacing, angularSpacing);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(24);
    expect(fc.avgCandidates).toBe(7.5);
  });

  it("maps category codes 0..3 to the expected strings", () => {
    const flat = buildFlat();
    const fc = unpackViewshedGrid(flat, launch, analysisRadius, radialSpacing, angularSpacing);
    const expected = ["blocked", "poor-angle", "partial", "good"];
    for (let i = 0; i < fc.features.length; i++) {
      expect(fc.features[i].properties.category).toBe(expected[i % 4]);
    }
  });

  it("attaches sampleLat / sampleLng that fall inside the analysis radius", () => {
    const flat = buildFlat();
    const fc = unpackViewshedGrid(flat, launch, analysisRadius, radialSpacing, angularSpacing);
    // Every sample should be within ~analysisRadius of launch — check via
    // a rough equirect distance to avoid pulling in the projector.
    for (const f of fc.features) {
      const { sampleLat, sampleLng } = f.properties;
      const dLat = (sampleLat - launch.lat) * 111320;
      const dLng = (sampleLng - launch.lng) * 111320 * Math.cos((launch.lat * Math.PI) / 180);
      const dist = Math.hypot(dLat, dLng);
      expect(dist).toBeLessThanOrEqual(analysisRadius);
      expect(dist).toBeGreaterThan(0);
    }
  });

  it("produces closed 4-corner sector polygons", () => {
    const flat = buildFlat();
    const fc = unpackViewshedGrid(flat, launch, analysisRadius, radialSpacing, angularSpacing);
    for (const f of fc.features) {
      const ring = f.geometry.coordinates[0];
      // Four unique corners + closing dup.
      expect(ring).toHaveLength(5);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
    }
  });
});

describe("unpackRooftopLayer", () => {
  const buildings = [
    {
      footprint: [[[-74.0, 40.7], [-73.999, 40.7], [-73.999, 40.701], [-74.0, 40.701], [-74.0, 40.7]]],
      height: 25,
    },
    {
      footprint: [[[-74.001, 40.7], [-74.0005, 40.7], [-74.0005, 40.7002], [-74.001, 40.7002], [-74.001, 40.7]]],
      height: 90,
    },
  ];

  it("returns one feature per input building in the same order", () => {
    // Two buildings → 6 floats: [frac0, score0, cat0, frac1, score1, cat1].
    const flat = new Float64Array([0.9, 0.4, 3,   0.05, 0.0, 0]);
    const fc = unpackRooftopLayer(flat, buildings);
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0].properties.frac).toBe(0.9);
    expect(fc.features[0].properties.category).toBe("good");
    expect(fc.features[1].properties.frac).toBe(0.05);
    expect(fc.features[1].properties.category).toBe("blocked");
  });

  it("carries buildingHeight and footprint through by index", () => {
    const flat = new Float64Array([1.0, 0.5, 3,   0.4, 0.1, 2]);
    const fc = unpackRooftopLayer(flat, buildings);
    expect(fc.features[0].properties.buildingHeight).toBe(25);
    expect(fc.features[1].properties.buildingHeight).toBe(90);
    expect(fc.features[0].geometry.coordinates).toBe(buildings[0].footprint);
    expect(fc.features[1].geometry.coordinates).toBe(buildings[1].footprint);
  });

  it("maps category code 4 to 'mixed' — the rooftop-only extension", () => {
    const flat = new Float64Array([0.7, 0.3, 4,   0.4, 0.2, 4]);
    const fc = unpackRooftopLayer(flat, buildings);
    expect(fc.features[0].properties.category).toBe("mixed");
    expect(fc.features[1].properties.category).toBe("mixed");
  });
});

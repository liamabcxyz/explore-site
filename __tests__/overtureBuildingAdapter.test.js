import { buildingsFromMapFeatures } from "@/lib/geo/overtureBuildingAdapter";

const squareRing = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];

function mapFeature(properties, geometry) {
  return { properties, geometry };
}

describe("buildingsFromMapFeatures", () => {
  it("normalizes a plain Polygon building with a real height", () => {
    const buildings = buildingsFromMapFeatures(
      [mapFeature({ height: 42, "@height_source": "OpenStreetMap" }, { type: "Polygon", coordinates: [squareRing] })],
      []
    );
    expect(buildings).toHaveLength(1);
    expect(buildings[0]).toMatchObject({ height: 42, confidence: "medium", source: "height" });
  });

  it("splits a MultiPolygon into one building entry per disjoint part", () => {
    const otherRing = [[10, 10], [10, 11], [11, 11], [11, 10], [10, 10]];
    const buildings = buildingsFromMapFeatures(
      [mapFeature({ height: 30 }, { type: "MultiPolygon", coordinates: [[squareRing], [otherRing]] })],
      []
    );
    expect(buildings).toHaveLength(2);
    expect(buildings[0].height).toBe(30);
    expect(buildings[1].height).toBe(30);
    expect(buildings[0].footprint).not.toEqual(buildings[1].footprint);
  });

  it("drops is_underground and has_parts buildings, keeps their building_part children", () => {
    const buildings = buildingsFromMapFeatures(
      [
        mapFeature({ height: 5, is_underground: true }, { type: "Polygon", coordinates: [squareRing] }),
        mapFeature({ height: 80, has_parts: true }, { type: "Polygon", coordinates: [squareRing] }),
      ],
      [mapFeature({ height: 80, building_id: "parent" }, { type: "Polygon", coordinates: [squareRing] })]
    );
    expect(buildings).toHaveLength(1);
    expect(buildings[0].height).toBe(80);
  });
});

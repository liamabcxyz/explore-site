import { normalizeBuilding, selectOccludingFeatures } from "@/lib/geo/normalizeBuilding";

const footprint = [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]];

describe("normalizeBuilding", () => {
  it("uses height directly when present, confidence high with no known heightSource", () => {
    const result = normalizeBuilding({ height: 42, num_floors: 99, class: "residential" }, footprint);
    expect(result).toMatchObject({ height: 42, base: 0, source: "height", confidence: "high" });
  });

  it("height still wins over num_floors/class even when all three are present", () => {
    const result = normalizeBuilding(
      { height: 42, min_height: 3, num_floors: 99, class: "commercial", heightSource: "OpenStreetMap" },
      footprint
    );
    expect(result.height).toBe(42);
    expect(result.base).toBe(3);
    expect(result.source).toBe("height");
  });

  it("downgrades confidence to medium for a known heightSource even when height is present", () => {
    const result = normalizeBuilding({ height: 42, heightSource: "OpenStreetMap" }, footprint);
    expect(result.confidence).toBe("medium");
  });

  it("falls back to num_floors * 3.2 (+ base) when height is missing", () => {
    const result = normalizeBuilding({ min_height: 5, num_floors: 10, class: "commercial" }, footprint);
    expect(result.height).toBeCloseTo(5 + 10 * 3.2);
    expect(result.source).toBe("num_floors");
    expect(result.confidence).toBe("medium");
  });

  it("falls back to a per-class default when both height and num_floors are missing", () => {
    const result = normalizeBuilding({ class: "residential" }, footprint);
    expect(result.height).toBe(10);
    expect(result.source).toBe("class-default");
    expect(result.confidence).toBe("low");
  });

  it("falls back to the generic default for an unknown/missing class", () => {
    const result = normalizeBuilding({}, footprint);
    expect(result.height).toBe(10);
    expect(result.confidence).toBe("low");
  });
});

describe("selectOccludingFeatures", () => {
  it("drops is_underground features from both building and building_part sets", () => {
    const buildings = [{ id: "a", is_underground: true }, { id: "b", is_underground: false }];
    const parts = [{ id: "c", is_underground: true }, { id: "d" }];
    const result = selectOccludingFeatures(buildings, parts);
    expect(result.map((f) => f.id)).toEqual(["b", "d"]);
  });

  it("drops has_parts buildings — their real massing comes from building_part instead", () => {
    const buildings = [{ id: "a", has_parts: true }, { id: "b", has_parts: false }];
    const parts = [{ id: "c", building_id: "a" }];
    const result = selectOccludingFeatures(buildings, parts);
    expect(result.map((f) => f.id)).toEqual(["b", "c"]);
  });
});

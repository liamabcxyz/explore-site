import {
  createAnnotation,
  categoriesFor,
  BUILDING_CATEGORIES,
  SPOT_CATEGORIES,
  MAX_ANNOTATIONS,
} from "@/lib/debug/annotations";
import { annotationsToGeoJson } from "@/lib/debug/annotationLayer";

describe("createAnnotation", () => {
  it("captures a building target as kind='building' with full building payload", () => {
    const ann = createAnnotation({
      lat: 40.7,
      lng: -74.0,
      building: { id: "b1", name: "Manor Church", height: 42, confidence: "medium" },
    });
    expect(ann).toMatchObject({
      kind: "building",
      lat: 40.7,
      lng: -74.0,
      building: { id: "b1", name: "Manor Church", height: 42, confidence: "medium" },
      category: null,
      note: "",
    });
    expect(ann.id).toMatch(/^ann-\d+-/);
    expect(typeof ann.createdAt).toBe("string");
  });

  it("captures an empty-ground click as kind='spot' with no building payload", () => {
    const ann = createAnnotation({ lat: 40.7, lng: -74.0 });
    expect(ann.kind).toBe("spot");
    expect(ann.building).toBeNull();
  });

  it("gives each annotation a unique id across successive calls", () => {
    const ids = new Set();
    for (let i = 0; i < 20; i++) ids.add(createAnnotation({ lat: 0, lng: 0 }).id);
    expect(ids.size).toBe(20);
  });

  it("gracefully handles missing sub-fields on a partial building payload", () => {
    const ann = createAnnotation({ lat: 40.7, lng: -74.0, building: {} });
    expect(ann.building).toEqual({ id: null, name: null, height: null, confidence: null });
  });
});

describe("categoriesFor", () => {
  it("returns building-specific categories for building-kind annotations", () => {
    expect(categoriesFor("building")).toBe(BUILDING_CATEGORIES);
  });
  it("returns spot-specific categories for spot-kind annotations", () => {
    expect(categoriesFor("spot")).toBe(SPOT_CATEGORIES);
  });
});

describe("annotationsToGeoJson", () => {
  it("assigns 1-based index labels so pin numbers match the dialog chip order", () => {
    const anns = [
      { id: "a", lat: 1, lng: 2, category: null },
      { id: "b", lat: 3, lng: 4, category: "wrong-blocker" },
    ];
    const gj = annotationsToGeoJson(anns);
    expect(gj.features.map((f) => f.properties.index)).toEqual([1, 2]);
  });

  it("preserves coordinates as [lng, lat] per GeoJSON convention", () => {
    const gj = annotationsToGeoJson([{ id: "a", lat: 40.7, lng: -74.0, category: null }]);
    expect(gj.features[0].geometry.coordinates).toEqual([-74.0, 40.7]);
  });

  it("returns an empty FeatureCollection for null/empty input", () => {
    expect(annotationsToGeoJson(null).features).toEqual([]);
    expect(annotationsToGeoJson([]).features).toEqual([]);
  });
});

describe("MAX_ANNOTATIONS", () => {
  it("is a small integer suitable for a bug-report UI", () => {
    expect(Number.isInteger(MAX_ANNOTATIONS)).toBe(true);
    expect(MAX_ANNOTATIONS).toBeGreaterThan(0);
    expect(MAX_ANNOTATIONS).toBeLessThanOrEqual(10);
  });
});

import { mapViewFromPlace, mapHrefFromPlace, CITY_MIN_ZOOM, CITY_MAX_ZOOM } from "@/lib/geocoder";

describe("mapViewFromPlace", () => {
  it("uses lat/lon at city zoom when there is no bbox", () => {
    const view = mapViewFromPlace({ lat: 37.7749, lon: -122.4194 });
    expect(view.center).toEqual([-122.4194, 37.7749]);
    expect(view.zoom).toBe(CITY_MAX_ZOOM);
  });

  it("fits a neighbourhood-scale bbox but never zooms past CITY_MAX_ZOOM", () => {
    const view = mapViewFromPlace({
      bbox: [-122.41, 37.78, -122.40, 37.79],
    });
    expect(view.center[0]).toBeCloseTo(-122.405);
    expect(view.center[1]).toBeCloseTo(37.785);
    expect(view.zoom).toBe(CITY_MAX_ZOOM);
  });

  it("clamps a city-wide bbox up to CITY_MIN_ZOOM so buildings are visible", () => {
    const view = mapViewFromPlace({
      bbox: [-122.52, 37.70, -122.35, 37.83],
    });
    expect(view.zoom).toBe(CITY_MIN_ZOOM);
  });

  it("returns null when the result has no location", () => {
    expect(mapViewFromPlace({ name: "nowhere" })).toBeNull();
  });
});

describe("mapHrefFromPlace", () => {
  it("builds a /map hash URL the map page already knows how to read", () => {
    expect(mapHrefFromPlace({ lat: 37.7749, lon: -122.4194 })).toBe(
      "/map#14.5/37.7749/-122.4194"
    );
  });
});

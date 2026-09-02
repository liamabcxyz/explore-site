// MapLibre source/layer registration for the "Report a problem" pins.
// Pure helpers — the actual React glue that calls these lives in
// MapView.jsx, matching how sightlineLayer.js works today.

export const ANNOTATION_SOURCE_ID = "vantage-annotations";
export const ANNOTATION_PIN_LAYER_ID = "vantage-annotations-pins";
export const ANNOTATION_LABEL_LAYER_ID = "vantage-annotations-labels";

/**
 * @param {Array<{id:string, lat:number, lng:number, category?: string|null}>} annotations
 * @returns {{type:"FeatureCollection", features:object[]}}
 */
export function annotationsToGeoJson(annotations) {
  return {
    type: "FeatureCollection",
    features: (annotations ?? []).map((a, i) => ({
      type: "Feature",
      properties: {
        id: a.id,
        // Human-readable label rendered on the map pin — 1-based index
        // matches how the dialog lists them ("Annotation 1, 2, 3") so
        // pin ↔ chip pairing is obvious.
        index: i + 1,
        category: a.category ?? "",
      },
      geometry: { type: "Point", coordinates: [a.lng, a.lat] },
    })),
  };
}

export function addAnnotationLayers(map) {
  if (map.getSource(ANNOTATION_SOURCE_ID)) return;
  map.addSource(ANNOTATION_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: ANNOTATION_PIN_LAYER_ID,
    type: "circle",
    source: ANNOTATION_SOURCE_ID,
    paint: {
      "circle-radius": 12,
      "circle-color": "#d32f2f",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
      "circle-opacity": 0.92,
    },
  });
  map.addLayer({
    id: ANNOTATION_LABEL_LAYER_ID,
    type: "symbol",
    source: ANNOTATION_SOURCE_ID,
    layout: {
      "text-field": ["to-string", ["get", "index"]],
      "text-size": 13,
      "text-font": ["Noto Sans Bold"],
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": "#ffffff",
    },
  });
}

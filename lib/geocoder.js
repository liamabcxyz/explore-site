export const GEOCODER_BASE = "https://geocoder.bradr.dev";

// Buildings extrude from zoom 14; dropping the user below that lands them
// in a city they can't actually analyze. Cap the other way so a tiny bbox
// (a neighbourhood) doesn't jump in closer than the header SearchBox does.
export const CITY_MIN_ZOOM = 14;
export const CITY_MAX_ZOOM = 14.5;

export const SUGGESTED_CITIES = [
  { name: "San Francisco", lat: 37.7749, lon: -122.4194, type: "locality", region: "California", country: "United States" },
  { name: "New York", lat: 40.7128, lon: -74.006, type: "locality", region: "New York", country: "United States" },
  { name: "London", lat: 51.5074, lon: -0.1278, type: "locality", region: "England", country: "United Kingdom" },
  { name: "Tokyo", lat: 35.6762, lon: 139.6503, type: "locality", region: "Tokyo", country: "Japan" },
  { name: "Shanghai", lat: 31.2304, lon: 121.4737, type: "locality", region: "Shanghai", country: "China" },
];

/**
 * Pick a map center + zoom for a geocoder result so the user lands at a
 * city-scale view where 3D buildings are already on. Prefers bbox when the
 * span is small enough; otherwise the centroid at CITY_MAX_ZOOM.
 */
export function mapViewFromPlace(result) {
  if (result.bbox && result.bbox.length === 4) {
    const [west, south, east, north] = result.bbox;
    const lngSpan = Math.abs(east - west);
    const latSpan = Math.abs(north - south);
    if (lngSpan > 0.001 && latSpan > 0.001) {
      const span = Math.max(lngSpan, latSpan);
      const fitted = Math.log2(360 / span);
      const zoom = Math.min(CITY_MAX_ZOOM, Math.max(CITY_MIN_ZOOM, fitted));
      return {
        center: [(west + east) / 2, (south + north) / 2],
        zoom,
      };
    }
  }

  if (result.lat != null && result.lon != null) {
    return { center: [result.lon, result.lat], zoom: CITY_MAX_ZOOM };
  }

  return null;
}

export function mapHrefFromPlace(result) {
  const view = mapViewFromPlace(result);
  if (!view) return null;
  const [lng, lat] = view.center;
  const zoom = Math.round(view.zoom * 100) / 100;
  return `/map#${zoom}/${lat}/${lng}`;
}

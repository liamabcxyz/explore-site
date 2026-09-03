// Direct Rust port of lib/geo/toLocalMeters.js's makeLocalProjector.
//
// Pure Rust — not exposed via wasm-bindgen because nothing on the JS side
// calls a projector directly; it's only used inside compute loops that
// live entirely on the Rust side of the boundary. A JS↔WASM parity check
// still lives in the fixture-diff test suite via a temporary test-only
// export (see `project_local_test` at the bottom).

const METERS_PER_DEGREE_LAT: f64 = 111_320.0;

/// Equirectangular WGS84 → local flat-meters projector, centered on an
/// origin. Accurate at neighborhood scale (city-block-sized error is far
/// under the height-data uncertainty the viewshed math already carries).
#[derive(Clone, Copy)]
pub struct LocalProjector {
    origin_lat: f64,
    origin_lng: f64,
    meters_per_degree_lng: f64,
}

impl LocalProjector {
    pub fn new(origin_lat: f64, origin_lng: f64) -> Self {
        let meters_per_degree_lng =
            METERS_PER_DEGREE_LAT * (origin_lat * std::f64::consts::PI / 180.0).cos();
        Self { origin_lat, origin_lng, meters_per_degree_lng }
    }

    #[inline]
    pub fn to_local(&self, lat: f64, lng: f64) -> (f64, f64) {
        (
            (lng - self.origin_lng) * self.meters_per_degree_lng,
            (lat - self.origin_lat) * METERS_PER_DEGREE_LAT,
        )
    }

    #[inline]
    pub fn to_latlng(&self, x: f64, y: f64) -> (f64, f64) {
        (
            self.origin_lat + y / METERS_PER_DEGREE_LAT,
            self.origin_lng + x / self.meters_per_degree_lng,
        )
    }
}

// -- test-only wasm exports -------------------------------------------------
// A JS test fixture reads (originLat, originLng, lat, lng) → (x, y) and
// checks against the JS reference. Four scalar exports rather than an
// array return keeps the wasm-bindgen surface primitive-only.

use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = "projectLocalX")]
pub fn project_local_x(origin_lat: f64, origin_lng: f64, lat: f64, lng: f64) -> f64 {
    LocalProjector::new(origin_lat, origin_lng).to_local(lat, lng).0
}

#[wasm_bindgen(js_name = "projectLocalY")]
pub fn project_local_y(origin_lat: f64, origin_lng: f64, lat: f64, lng: f64) -> f64 {
    LocalProjector::new(origin_lat, origin_lng).to_local(lat, lng).1
}

#[wasm_bindgen(js_name = "projectLatLngLat")]
pub fn project_latlng_lat(origin_lat: f64, origin_lng: f64, x: f64, y: f64) -> f64 {
    LocalProjector::new(origin_lat, origin_lng).to_latlng(x, y).0
}

#[wasm_bindgen(js_name = "projectLatLngLng")]
pub fn project_latlng_lng(origin_lat: f64, origin_lng: f64, x: f64, y: f64) -> f64 {
    LocalProjector::new(origin_lat, origin_lng).to_latlng(x, y).1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_projects_to_zero() {
        let p = LocalProjector::new(40.7, -74.0);
        assert_eq!(p.to_local(40.7, -74.0), (0.0, 0.0));
    }

    #[test]
    fn round_trip() {
        let p = LocalProjector::new(40.7, -74.0);
        let (x, y) = p.to_local(40.71, -73.98);
        let (lat2, lng2) = p.to_latlng(x, y);
        assert!((lat2 - 40.71).abs() < 1e-9);
        assert!((lng2 - (-73.98)).abs() < 1e-9);
    }

    #[test]
    fn latitude_scale_matches_constant() {
        let p = LocalProjector::new(0.0, 0.0);
        // 1 degree of latitude → 111320 m regardless of longitude
        let (_, y) = p.to_local(1.0, 0.0);
        assert_eq!(y, METERS_PER_DEGREE_LAT);
    }
}

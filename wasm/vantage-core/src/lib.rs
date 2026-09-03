// VANTAGE viewshed compute kernels, ported from lib/viewshed/*.js.
//
// Phase A committed a single `fraction_visible` export to prove the
// toolchain end-to-end. Phase C1 (this) adds the rest of the pure-math
// layer: scoring, earth-curvature, and the local-meters projector.
// Phase C2 onwards adds geometry (ray-polygon intersection, spatial
// index, elevation-grid lookup) and finally the outer compute loops.
//
// Everything here is a direct 1:1 port of the JavaScript reference in
// `lib/viewshed/*.js` and `lib/geo/*.js`. Behavior parity is enforced
// by fixture-diff tests on the JS side (see __tests__/vantageCore*).

// C1 — pure math
mod curvature;
mod projector;
mod scoring;
// C2 — geometry helpers
mod building_index;
mod elevation_grid;
pub mod geo;
mod sightline;

// Re-export the wasm-bindgen surface. wasm-bindgen only walks the crate
// root for exports, so every function that needs to be callable from JS
// gets surfaced here.

pub use curvature::{apparent_altitude, apparent_altitude_k, curvature_drop, curvature_drop_k};
pub use elevation_grid::elevation_bilinear;
pub use projector::{project_latlng_lat, project_latlng_lng, project_local_x, project_local_y};
pub use scoring::{
    angular_size_gate, apparent_angular_diameter_deg, comfort_factor, elevation_angle_deg,
    elevation_score, eye_height, fraction_visible, is_blocked, score, visibility_category,
};
pub use sightline::intersect_segment_building_flat;

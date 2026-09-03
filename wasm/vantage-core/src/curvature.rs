// Direct Rust port of lib/viewshed/curvature.js.

use wasm_bindgen::prelude::*;

pub const REFRACTION_K: f64 = 1.13;
pub const EARTH_RADIUS_M: f64 = 6_371_000.0;

#[wasm_bindgen]
pub fn curvature_drop(distance_meters: f64) -> f64 {
    curvature_drop_k(distance_meters, REFRACTION_K)
}

#[wasm_bindgen]
pub fn curvature_drop_k(distance_meters: f64, k: f64) -> f64 {
    if !(distance_meters > 0.0) {
        return 0.0;
    }
    (distance_meters * distance_meters) / (2.0 * k * EARTH_RADIUS_M)
}

#[wasm_bindgen]
pub fn apparent_altitude(orthometric_meters: f64, distance_meters: f64) -> f64 {
    orthometric_meters - curvature_drop(distance_meters)
}

#[wasm_bindgen]
pub fn apparent_altitude_k(orthometric_meters: f64, distance_meters: f64, k: f64) -> f64 {
    orthometric_meters - curvature_drop_k(distance_meters, k)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_distance_zero_drop() {
        assert_eq!(curvature_drop(0.0), 0.0);
        assert_eq!(curvature_drop(-100.0), 0.0);
    }

    #[test]
    fn drops_grow_with_square_of_distance() {
        let d1 = curvature_drop(1000.0);
        let d2 = curvature_drop(2000.0);
        // Doubling d quadruples drop, up to floating-point noise.
        assert!(((d2 / d1) - 4.0).abs() < 1e-9);
    }

    #[test]
    fn apparent_altitude_subtracts_the_drop() {
        let raw = 100.0;
        let d = 5000.0;
        assert!((apparent_altitude(raw, d) - (raw - curvature_drop(d))).abs() < 1e-12);
    }
}

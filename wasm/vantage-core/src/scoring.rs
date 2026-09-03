// Direct Rust port of lib/viewshed/scoring.js. See that file for design
// notes and 烟花可视性数学模型.md for the underlying math.
//
// Every function here is a pure port — same formula, same edge cases,
// same output to the last bit of f64 precision. That last-bit
// equivalence is enforced by __tests__/vantageCoreFixtures.test.js
// (JS ↔ WASM cross-check on a fixed input set).

use wasm_bindgen::prelude::*;

pub const EYE_HEIGHT: f64 = 1.6;

#[wasm_bindgen(js_name = "eyeHeight")]
pub fn eye_height() -> f64 {
    EYE_HEIGHT
}

#[wasm_bindgen]
pub fn fraction_visible(min_alt: f64, target_height: f64, shell_radius: f64) -> f64 {
    let k = (min_alt - target_height) / shell_radius;
    if k <= -1.0 {
        return 1.0;
    }
    if k >= 1.0 {
        return 0.0;
    }
    (k.acos() - k * (1.0 - k * k).sqrt()) / std::f64::consts::PI
}

#[wasm_bindgen]
pub fn elevation_angle_deg(horizontal_distance: f64, height_diff: f64) -> f64 {
    height_diff.atan2(horizontal_distance) * (180.0 / std::f64::consts::PI)
}

#[wasm_bindgen]
pub fn apparent_angular_diameter_deg(
    horizontal_distance: f64,
    height_diff: f64,
    shell_radius: f64,
) -> f64 {
    let slant_distance = (horizontal_distance * horizontal_distance + height_diff * height_diff).sqrt();
    2.0 * (shell_radius / slant_distance).atan() * (180.0 / std::f64::consts::PI)
}

// Provisional constants — see scoring.js notes on why these numbers.
const THETA_MIN_DEG: f64 = 0.4;
const THETA_STEEPNESS: f64 = 22.0;

#[wasm_bindgen]
pub fn angular_size_gate(theta_deg: f64) -> f64 {
    1.0 / (1.0 + (-THETA_STEEPNESS * (theta_deg - THETA_MIN_DEG)).exp())
}

const PHI_LOW_ZERO: f64 = 5.0;
const PHI_LOW_FULL: f64 = 15.0;
const PHI_HIGH_FULL: f64 = 35.0;
const PHI_HIGH_ZERO: f64 = 45.0;

fn smoothstep(edge0: f64, edge1: f64, x: f64) -> f64 {
    let t = ((x - edge0) / (edge1 - edge0)).max(0.0).min(1.0);
    t * t * (3.0 - 2.0 * t)
}

#[wasm_bindgen]
pub fn elevation_score(phi_deg: f64) -> f64 {
    if phi_deg <= PHI_LOW_ZERO {
        return 0.0;
    }
    if phi_deg < PHI_LOW_FULL {
        return smoothstep(PHI_LOW_ZERO, PHI_LOW_FULL, phi_deg);
    }
    if phi_deg <= PHI_HIGH_FULL {
        return 1.0;
    }
    if phi_deg < PHI_HIGH_ZERO {
        return 1.0 - smoothstep(PHI_HIGH_FULL, PHI_HIGH_ZERO, phi_deg);
    }
    0.0
}

/// Composite score. `weather` defaults to 1 on the JS side; wasm-bindgen
/// doesn't support optional args cleanly, so callers always pass it. The
/// only current caller (computeViewshed loops) always has the value in
/// hand, so no ergonomics loss.
#[wasm_bindgen]
pub fn score(
    min_alt: f64,
    target_height: f64,
    shell_radius: f64,
    eye_h: f64,
    horizontal_distance: f64,
    weather: f64,
) -> f64 {
    let height_diff = target_height - eye_h;
    let frac = fraction_visible(min_alt, target_height, shell_radius);
    let theta = apparent_angular_diameter_deg(horizontal_distance, height_diff, shell_radius);
    let phi = elevation_angle_deg(horizontal_distance, height_diff);
    frac * weather * angular_size_gate(theta) * elevation_score(phi)
}

#[wasm_bindgen]
pub fn comfort_factor(theta_deg: f64, phi_deg: f64) -> f64 {
    angular_size_gate(theta_deg) * elevation_score(phi_deg)
}

const BLOCKED_FRAC_THRESHOLD: f64 = 0.15;
const COMFORT_THRESHOLD: f64 = 0.5;
const PARTIAL_FRAC_THRESHOLD: f64 = 0.85;

/// Returns a small integer for the category so the wasm-bindgen boundary
/// stays as a numeric primitive rather than allocating a JS string on
/// every cell. JS side maps: 0=blocked, 1=poor-angle, 2=partial, 3=good.
#[wasm_bindgen]
pub fn visibility_category(frac: f64, comfort: f64) -> u32 {
    if frac < BLOCKED_FRAC_THRESHOLD {
        return 0; // blocked
    }
    if comfort < COMFORT_THRESHOLD {
        return 1; // poor-angle
    }
    if frac < PARTIAL_FRAC_THRESHOLD {
        return 2; // partial
    }
    3 // good
}

#[wasm_bindgen]
pub fn is_blocked(frac: f64) -> bool {
    frac < BLOCKED_FRAC_THRESHOLD
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fraction_visible_edges() {
        assert_eq!(fraction_visible(100.0, 200.0, 50.0), 1.0);
        assert_eq!(fraction_visible(300.0, 200.0, 50.0), 0.0);
        assert!((fraction_visible(200.0, 200.0, 50.0) - 0.5).abs() < 1e-12);
    }

    #[test]
    fn angular_size_gate_midpoint() {
        // At threshold, sigmoid gives 0.5.
        assert!((angular_size_gate(THETA_MIN_DEG) - 0.5).abs() < 1e-12);
    }

    #[test]
    fn elevation_score_hard_zeros_and_ones() {
        assert_eq!(elevation_score(0.0), 0.0);
        assert_eq!(elevation_score(PHI_LOW_ZERO), 0.0);
        assert_eq!(elevation_score(20.0), 1.0);
        assert_eq!(elevation_score(PHI_HIGH_ZERO), 0.0);
        assert_eq!(elevation_score(60.0), 0.0);
    }

    #[test]
    fn category_ordering() {
        assert_eq!(visibility_category(0.05, 0.9), 0); // blocked wins
        assert_eq!(visibility_category(0.9, 0.1), 1);  // poor angle
        assert_eq!(visibility_category(0.5, 0.9), 2);  // partial
        assert_eq!(visibility_category(0.95, 0.9), 3); // good
    }
}

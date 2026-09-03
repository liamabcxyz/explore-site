// Phase-A minimal WASM kernel — proves the toolchain, worker integration,
// and float round-trip work end-to-end.
//
// One exported function: `fraction_visible`, a direct port of
// `lib/viewshed/scoring.js`'s `fractionVisible`. Same math, same edge cases,
// same floats (JS f64 ⇄ Rust f64 via wasm-bindgen — no lossy conversion).
//
// Once this loads and executes correctly from the browser Worker,
// subsequent phases port the hot loops (`computeViewshed`,
// `computeRooftopLayer`) onto the same pipeline.

use wasm_bindgen::prelude::*;

/// Geometrically exact fraction of a shell's disk that sits above the
/// nearest obstruction. See 烟花可视性数学模型.md §3.2 for the derivation
/// and `lib/viewshed/scoring.js` for the JavaScript reference
/// implementation this mirrors.
///
/// `k = (min_alt - target_height) / shell_radius` is the horizontal cut
/// line in units of R from the disk center. `f(k) = [acos(k) − k·√(1−k²)] / π`.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fully_visible_when_obstruction_below_shell() {
        // k = -2 → cut line 2 radii below center → whole disk clears.
        assert_eq!(fraction_visible(100.0, 200.0, 50.0), 1.0);
    }

    #[test]
    fn fully_blocked_when_obstruction_above_shell() {
        // k = +2 → cut line 2 radii above center → nothing clears.
        assert_eq!(fraction_visible(300.0, 200.0, 50.0), 0.0);
    }

    #[test]
    fn half_visible_when_cut_through_center() {
        // k = 0 → symmetry gives exactly 0.5 of the disk.
        let f = fraction_visible(200.0, 200.0, 50.0);
        assert!((f - 0.5).abs() < 1e-12);
    }

    #[test]
    fn matches_js_reference_at_k_equals_half() {
        // From scoring.js comment: k=0.5 is ≈0.196 (linear approx would say 0.25).
        let f = fraction_visible(225.0, 200.0, 50.0);
        assert!((f - 0.19550110947788535).abs() < 1e-9, "got {}", f);
    }
}

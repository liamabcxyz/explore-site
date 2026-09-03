// Rust port of the ElevationGrid data class from
// lib/viewshed/ElevationGrid.js (`getElevation` bilinear interpolation +
// `hasCoverage`). The fetch/decode side (Terrarium PNG → Float32Array)
// stays in JS — network + createImageBitmap + OffscreenCanvas are
// browser-only APIs the WASM side can't reach.
//
// Data layout matches the JS side exactly: row-major Float32Array, one
// f32 per pixel, index 0 is the top-left (NW) pixel. Same coordinate
// convention: `lat_step_deg` is *negative* (lat decreases as row grows),
// `lng_step_deg` positive.

/// Owned elevation grid — construction copies the f32 slice into a Vec.
/// For the WASM boundary we'll design C3 to accept a shared view rather
/// than copy, but internally the Rust compute loops need something with
/// a stable lifetime.
#[derive(Clone, Debug)]
pub struct ElevationGrid {
    data: Vec<f32>,
    pub cells_x: u32,
    pub cells_y: u32,
    pub north_lat: f64,
    pub west_lng: f64,
    pub lat_step_deg: f64, // negative
    pub lng_step_deg: f64, // positive
    south_lat: f64,
    east_lng: f64,
}

impl ElevationGrid {
    pub fn new(
        data: Vec<f32>,
        cells_x: u32,
        cells_y: u32,
        north_lat: f64,
        west_lng: f64,
        lat_step_deg: f64,
        lng_step_deg: f64,
    ) -> Result<Self, String> {
        let expected = (cells_x as usize) * (cells_y as usize);
        if data.len() != expected {
            return Err(format!(
                "ElevationGrid data length {} != cells_x*cells_y ({})",
                data.len(), expected
            ));
        }
        let south_lat = north_lat + lat_step_deg * (cells_y as f64 - 1.0);
        let east_lng = west_lng + lng_step_deg * (cells_x as f64 - 1.0);
        Ok(Self {
            data, cells_x, cells_y, north_lat, west_lng, lat_step_deg, lng_step_deg,
            south_lat, east_lng,
        })
    }

    /// All-zeros grid over an arbitrary bbox — matches
    /// `ElevationGrid.flat` in the JS reference. Used by tests that want
    /// terrain-shaped input without real terrain data.
    pub fn flat(west_lng: f64, north_lat: f64, east_lng: f64, south_lat: f64) -> Self {
        let cells_x = 2u32;
        let cells_y = 2u32;
        let data = vec![0.0f32; (cells_x * cells_y) as usize];
        let lng_step_deg = (east_lng - west_lng) / (cells_x as f64 - 1.0);
        let lat_step_deg = (south_lat - north_lat) / (cells_y as f64 - 1.0);
        Self::new(data, cells_x, cells_y, north_lat, west_lng, lat_step_deg, lng_step_deg)
            .expect("flat() constants are always valid")
    }

    /// True if (lng, lat) sits inside the covered rectangle. Boundary
    /// points count as covered — matches the JS reference.
    #[inline]
    pub fn has_coverage(&self, lng: f64, lat: f64) -> bool {
        lng >= self.west_lng && lng <= self.east_lng
            && lat >= self.south_lat && lat <= self.north_lat
    }

    /// Bilinear interpolation of the 4 pixels around (lng, lat).
    /// Returns `Some(meters)` inside coverage, `None` outside — matches
    /// the JS `null` return for out-of-bounds.
    #[inline]
    pub fn get_elevation(&self, lng: f64, lat: f64) -> Option<f64> {
        if !self.has_coverage(lng, lat) { return None; }
        let col = (lng - self.west_lng) / self.lng_step_deg;
        let row = (lat - self.north_lat) / self.lat_step_deg; // both negative → positive
        // Clamp so a query exactly at the SE edge still has 4 valid pixels.
        let c0 = (col.floor() as i32).min(self.cells_x as i32 - 2).max(0) as usize;
        let r0 = (row.floor() as i32).min(self.cells_y as i32 - 2).max(0) as usize;
        let fx = col - c0 as f64;
        let fy = row - r0 as f64;
        let w = self.cells_x as usize;
        let v00 = self.data[r0 * w + c0] as f64;
        let v10 = self.data[r0 * w + (c0 + 1)] as f64;
        let v01 = self.data[(r0 + 1) * w + c0] as f64;
        let v11 = self.data[(r0 + 1) * w + (c0 + 1)] as f64;
        Some(
            v00 * (1.0 - fx) * (1.0 - fy)
            + v10 * fx * (1.0 - fy)
            + v01 * (1.0 - fx) * fy
            + v11 * fx * fy
        )
    }
}

// -- test-only wasm exports -------------------------------------------------
// Flat function that packages the whole "build a grid + query one point"
// dance so the JS-side self-check can validate parity without holding a
// long-lived WASM object. Real compute-loop use (C4) will hold an owned
// ElevationGrid inside Rust.

use wasm_bindgen::prelude::*;

/// Test-only: bilinear elevation lookup returning `f64::NAN` outside
/// coverage (rather than `null`, since we can't return Option across
/// the wasm-bindgen boundary as one f64 easily).
#[wasm_bindgen(js_name = "elevationBilinear")]
pub fn elevation_bilinear(
    data: &[f32],
    cells_x: u32,
    cells_y: u32,
    north_lat: f64,
    west_lng: f64,
    lat_step_deg: f64,
    lng_step_deg: f64,
    lng: f64,
    lat: f64,
) -> f64 {
    let grid = match ElevationGrid::new(
        data.to_vec(), cells_x, cells_y, north_lat, west_lng, lat_step_deg, lng_step_deg,
    ) {
        Ok(g) => g,
        Err(_) => return f64::NAN,
    };
    grid.get_elevation(lng, lat).unwrap_or(f64::NAN)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_grid_returns_zero_everywhere() {
        let g = ElevationGrid::flat(-74.0, 40.71, -73.99, 40.70);
        assert_eq!(g.get_elevation(-73.995, 40.705), Some(0.0));
    }

    #[test]
    fn out_of_coverage_is_none() {
        let g = ElevationGrid::flat(-74.0, 40.71, -73.99, 40.70);
        assert!(g.get_elevation(-100.0, 40.705).is_none());
    }

    #[test]
    fn bilinear_between_two_pixels() {
        // 2×1 pixels: [10, 20]. lat covers a single row (degenerate but valid).
        // Query at the midpoint → 15.
        // But we need at least 2 rows for r0 to work; use 2×2 with rows [10,20]/[10,20].
        let data = vec![10.0, 20.0, 10.0, 20.0];
        let g = ElevationGrid::new(
            data, 2, 2, /*north*/ 40.71, /*west*/ -74.0,
            /*lat_step*/ -0.01, /*lng_step*/ 0.01,
        ).unwrap();
        // Midway between east/west columns:
        let e = g.get_elevation(-73.995, 40.71).unwrap();
        assert!((e - 15.0).abs() < 1e-6, "got {}", e);
    }
}

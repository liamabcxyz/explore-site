// JS ↔ Rust data contract for the compute pipeline.
//
// Design principles (see wasm/vantage-core/README.md for the full
// discussion):
//
//  - Everything crosses the wasm-bindgen boundary as primitives or flat
//    typed arrays. No JS objects, no strings.
//  - Buildings are packed as three parallel arrays (heights,
//    vertex_counts, vertex_data) rather than one interleaved buffer so
//    heights can stay in f32 (saves 40% on that column) and the vertex
//    stream stays f64-precision (needed for local-meters coordinates at
//    city scale).
//  - Terrain rides its native Float32Array + 6 metadata scalars.
//  - Fields the compute doesn't read (`name`, `confidence`, `id`,
//    interior rings) are NOT marshaled — they stay on the JS side and
//    get re-attached by index after WASM returns.
//
// This module contains only the deserializers + a test-only helper.
// The outer compute functions (Phase C4/C5) call `deserialize_buildings`
// and `deserialize_terrain` internally; JS callers never touch them
// directly, they just pass the four/seven arrays into `compute_viewshed`
// et al.

use crate::elevation_grid::ElevationGrid;
use crate::geo::{Building, Point2};

/// Reconstruct a Vec<Building> from the JS-side packed representation.
///
/// # Layout
/// - `heights[i]`: absolute-altitude roofline of building i (f32 meters)
/// - `vertex_counts[i]`: number of (x,y) vertices in building i's
///   exterior ring — including the closing duplicate, matching the
///   GeoJSON convention on the JS side
/// - `vertex_data`: flat concatenation of all rings in building order,
///   `[x0,y0,x1,y1,...]` for building 0, then building 1, etc. Total
///   length must equal `2 * Σ vertex_counts[i]`.
///
/// Returns `Err` on shape mismatch — a length lie between the three
/// arrays would silently misalign buildings otherwise, and there's no
/// downstream error surface that would notice.
pub fn deserialize_buildings(
    heights: &[f32],
    vertex_counts: &[u32],
    vertex_data: &[f64],
) -> Result<Vec<Building>, String> {
    if heights.len() != vertex_counts.len() {
        return Err(format!(
            "marshaling: heights ({}) != vertex_counts ({})",
            heights.len(), vertex_counts.len()
        ));
    }
    let expected_verts: usize = vertex_counts.iter().map(|n| *n as usize).sum();
    if vertex_data.len() != expected_verts * 2 {
        return Err(format!(
            "marshaling: vertex_data has {} floats, expected {} (2 * sum of vertex_counts)",
            vertex_data.len(), expected_verts * 2
        ));
    }
    let mut buildings = Vec::with_capacity(heights.len());
    let mut off = 0usize;
    for (idx, &n_verts) in vertex_counts.iter().enumerate() {
        let n = n_verts as usize;
        let mut ring: Vec<Point2> = Vec::with_capacity(n);
        for _ in 0..n {
            let x = vertex_data[off];
            let y = vertex_data[off + 1];
            off += 2;
            ring.push([x, y]);
        }
        buildings.push(Building {
            footprint: vec![ring],
            height: heights[idx] as f64,
        });
    }
    Ok(buildings)
}

/// Reconstruct an ElevationGrid from the JS-side packed representation.
///
/// The `data` slice is copied into an owned Vec inside the grid —
/// wasm-bindgen's `&[f32]` param does a memcpy from JS memory into
/// linear memory regardless, and downstream compute holds the grid for
/// the whole request, so a zero-copy borrow would just complicate
/// lifetimes without saving anything real.
#[allow(clippy::too_many_arguments)]
pub fn deserialize_terrain(
    data: &[f32],
    cells_x: u32,
    cells_y: u32,
    north_lat: f64,
    west_lng: f64,
    lat_step_deg: f64,
    lng_step_deg: f64,
) -> Result<ElevationGrid, String> {
    ElevationGrid::new(
        data.to_vec(), cells_x, cells_y,
        north_lat, west_lng, lat_step_deg, lng_step_deg,
    )
}

// -- test-only wasm exports -------------------------------------------------
//
// A round-trip probe so the JS-side self-check can prove the packing
// contract is honored across the boundary. We compute a few reductions
// over the deserialized data (checksums + summary stats) and return
// them as one packed Float64Array; the JS side computes the same
// reductions on its own side and diffs.

use wasm_bindgen::prelude::*;

/// Returns [n_buildings, total_verts, sum_heights, min_x, max_x, min_y, max_y].
/// Empty input returns [0, 0, 0, +Inf, -Inf, +Inf, -Inf].
#[wasm_bindgen(js_name = "roundtripBuildings")]
pub fn roundtrip_buildings(
    heights: &[f32],
    vertex_counts: &[u32],
    vertex_data: &[f64],
) -> Vec<f64> {
    let buildings = match deserialize_buildings(heights, vertex_counts, vertex_data) {
        Ok(b) => b,
        Err(_) => return vec![f64::NAN; 7],
    };
    let mut total_verts = 0u64;
    let mut sum_heights = 0.0f64;
    let mut min_x = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for b in &buildings {
        sum_heights += b.height;
        for ring in &b.footprint {
            total_verts += ring.len() as u64;
            for pt in ring {
                if pt[0] < min_x { min_x = pt[0]; }
                if pt[0] > max_x { max_x = pt[0]; }
                if pt[1] < min_y { min_y = pt[1]; }
                if pt[1] > max_y { max_y = pt[1]; }
            }
        }
    }
    vec![
        buildings.len() as f64,
        total_verts as f64,
        sum_heights,
        min_x, max_x, min_y, max_y,
    ]
}

/// Returns [cells_x, cells_y, south_lat, east_lng, sum_of_data].
/// `sum_of_data` is the reduction that catches any silent per-pixel
/// corruption (a mismatched Float32Array view would give a totally
/// different sum). NaN row on shape/length failure.
#[wasm_bindgen(js_name = "roundtripTerrain")]
pub fn roundtrip_terrain(
    data: &[f32],
    cells_x: u32,
    cells_y: u32,
    north_lat: f64,
    west_lng: f64,
    lat_step_deg: f64,
    lng_step_deg: f64,
) -> Vec<f64> {
    let grid = match deserialize_terrain(
        data, cells_x, cells_y, north_lat, west_lng, lat_step_deg, lng_step_deg,
    ) {
        Ok(g) => g,
        Err(_) => return vec![f64::NAN; 5],
    };
    let sum: f64 = data.iter().map(|v| *v as f64).sum();
    // Expose the derived SE corner (matches ElevationGrid._south_lat /
    // _east_lng in the JS reference). Uses south_lat / east_lng which
    // aren't public on ElevationGrid — recompute here from the same
    // formula.
    let south_lat = north_lat + lat_step_deg * (grid.cells_y as f64 - 1.0);
    let east_lng = west_lng + lng_step_deg * (grid.cells_x as f64 - 1.0);
    vec![grid.cells_x as f64, grid.cells_y as f64, south_lat, east_lng, sum]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_a_single_square_building() {
        let heights = vec![42.0f32];
        let vertex_counts = vec![5u32]; // closed ring: 4 unique + closing dup
        let vertex_data = vec![
            0.0, 0.0,
            10.0, 0.0,
            10.0, 10.0,
            0.0, 10.0,
            0.0, 0.0,
        ];
        let bldgs = deserialize_buildings(&heights, &vertex_counts, &vertex_data).unwrap();
        assert_eq!(bldgs.len(), 1);
        assert_eq!(bldgs[0].height, 42.0);
        assert_eq!(bldgs[0].footprint[0].len(), 5);
        assert_eq!(bldgs[0].footprint[0][2], [10.0, 10.0]);
    }

    #[test]
    fn deserializes_multiple_buildings_by_running_offset() {
        // Two buildings: 3-vertex triangle then 4-vertex square.
        let heights = vec![10.0f32, 20.0];
        let vertex_counts = vec![3u32, 4];
        let vertex_data = vec![
            0.0, 0.0, 1.0, 0.0, 0.5, 1.0,           // triangle
            5.0, 5.0, 7.0, 5.0, 7.0, 7.0, 5.0, 7.0, // square
        ];
        let bldgs = deserialize_buildings(&heights, &vertex_counts, &vertex_data).unwrap();
        assert_eq!(bldgs.len(), 2);
        assert_eq!(bldgs[0].footprint[0].len(), 3);
        assert_eq!(bldgs[1].footprint[0].len(), 4);
        assert_eq!(bldgs[1].footprint[0][2], [7.0, 7.0]);
    }

    #[test]
    fn shape_mismatches_error() {
        // heights and vertex_counts disagree
        assert!(deserialize_buildings(&[1.0], &[3, 4], &[]).is_err());
        // vertex_data too short
        assert!(deserialize_buildings(&[1.0f32], &[3u32], &[0.0, 0.0, 1.0]).is_err());
    }

    #[test]
    fn terrain_round_trip_preserves_values() {
        let data = vec![10.0f32, 20.0, 30.0, 40.0];
        let g = deserialize_terrain(&data, 2, 2, 40.71, -74.0, -0.01, 0.01).unwrap();
        assert!(g.has_coverage(-74.0, 40.71));
        assert!((g.get_elevation(-74.0, 40.71).unwrap() - 10.0).abs() < 1e-6);
    }
}

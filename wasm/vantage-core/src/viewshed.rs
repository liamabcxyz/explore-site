// Direct Rust port of lib/viewshed/computeViewshed.js — the polar
// sector×ring viewshed grid. Same math, same iteration order, same
// obstacle-collection semantics; f64 throughout so cell values are
// bit-identical to the JS reference (proven by worker.js's C4 self-
// check).
//
// Inputs match the JS `computeViewshed({...})` shape as closely as
// possible: raw normalized buildings (footprints as [lng, lat] pairs,
// height meters-above-base) and an optional terrain grid. Projection
// to local meters and terrain-lifting of building rooflines happen
// here — pushing them into JS would mean the parity check no longer
// tests the algorithm's terrain arithmetic.
//
// Output layout (returned as one flat Vec<f64>):
//   [0]                      : avg_candidates (JS's per-sector obstacle count average)
//   [1 + 3*i .. 1 + 3*i + 2] : cell i's (frac, score, category-as-f64)
// where cell index i = sector_index * num_rings + ring_index, matching
// the outer/inner loop order in JS. Rebuilding the FeatureCollection
// (sample lat/lng, polygon corners, category-as-string) is JS's job.
//
// Sentinel: an empty return signals a shape error from the marshaling
// layer — no valid non-degenerate scene ever produces a zero-length
// buffer (the header alone occupies index 0).

use crate::building_index::BuildingIndex;
use crate::elevation_grid::ElevationGrid;
use crate::geo::{Building, Point2, Point3};
use crate::projector::LocalProjector;
use crate::scoring::{
    apparent_angular_diameter_deg, comfort_factor, elevation_angle_deg, fraction_visible,
    score as composite_score, visibility_category, EYE_HEIGHT,
};
use crate::sightline::intersect_segment_building;
use std::f64::consts::PI;
use wasm_bindgen::prelude::*;

/// Terrain sampling density along each bearing ray, in meters.
/// Matches the same-named constant in the JS reference — coarser than
/// the ~10m Terrarium pixel but fine enough to catch city-scale ridges.
const TERRAIN_STEP: f64 = 20.0;

/// Per-cell scoring output. Category is 0=blocked / 1=poor-angle /
/// 2=partial / 3=good — JS maps back to the string label after unpacking.
#[derive(Clone, Copy, Debug)]
pub struct CellScore {
    pub frac: f64,
    pub score: f64,
    pub category: u32,
}

pub struct ViewshedResult {
    // Retained on the pure-Rust return so future internal callers (a
    // rooftop pass that wants to pin its samples to the same grid, a
    // test helper) don't have to re-derive dimensions from the raw
    // params; the wasm entry drops them because JS callers derive
    // them cheaply from (analysis_radius, radial_spacing,
    // angular_spacing_deg) themselves.
    #[allow(dead_code)]
    pub num_sectors: u32,
    #[allow(dead_code)]
    pub num_rings: u32,
    pub avg_candidates: f64,
    /// Sector-major: cells[sector * num_rings + ring].
    pub cells: Vec<CellScore>,
}

struct Obstacle {
    distance: f64,
    height: f64,
}

/// Pure Rust `computeViewshed`. Buildings arrive with footprints in
/// [lng, lat] pairs (matching the JS raw normalized shape); this
/// function does the local-meters projection and terrain-lifting
/// itself so the parity check covers those steps.
#[allow(clippy::too_many_arguments)]
pub fn compute_viewshed_core(
    launch_lat: f64,
    launch_lng: f64,
    target_height: f64,
    shell_radius: f64,
    analysis_radius: f64,
    radial_spacing: f64,
    angular_spacing_deg: f64,
    buildings_latlng: &[Building],
    terrain: Option<&ElevationGrid>,
) -> ViewshedResult {
    let projector = LocalProjector::new(launch_lat, launch_lng);
    // Matches the JS `groundElev` closure: 0 for "no terrain" AND for
    // "outside coverage." Both fallbacks are load-bearing — the DEM
    // pad rarely covers the full analysis radius, and the pre-Phase-3
    // fixtures rely on a null grid being a no-op.
    let ground_elev = |lng: f64, lat: f64| -> f64 {
        terrain.and_then(|g| g.get_elevation(lng, lat)).unwrap_or(0.0)
    };

    let launch_elev = ground_elev(launch_lng, launch_lat);
    let target_abs_alt = launch_elev + target_height;

    // Project every footprint into local meters and lift heights to
    // absolute-altitude rooflines. One centroid → one terrain lookup →
    // one baseline per building — same rule the JS reference relies on
    // (see 实施方案.md §4.5 for why per-corner bases can't be used).
    let local_buildings: Vec<Building> = buildings_latlng
        .iter()
        .map(|b| {
            let ring = &b.footprint[0];
            // Drop the closing duplicate before averaging so the
            // centroid isn't biased toward vertex 0.
            let verts = &ring[..ring.len() - 1];
            let mut sum_lng = 0.0f64;
            let mut sum_lat = 0.0f64;
            for pt in verts {
                sum_lng += pt[0];
                sum_lat += pt[1];
            }
            let centroid_lng = sum_lng / verts.len() as f64;
            let centroid_lat = sum_lat / verts.len() as f64;
            let bldg_elev = ground_elev(centroid_lng, centroid_lat);
            let projected: Vec<Vec<Point2>> = b
                .footprint
                .iter()
                .map(|ring2| {
                    ring2
                        .iter()
                        .map(|pt| {
                            // JS convention: footprint is [lng, lat].
                            let (x, y) = projector.to_local(pt[1], pt[0]);
                            [x, y]
                        })
                        .collect()
                })
                .collect();
            Building {
                footprint: projected,
                height: bldg_elev + b.height,
            }
        })
        .collect();

    let building_index = BuildingIndex::build(&local_buildings);

    let num_rings = (analysis_radius / radial_spacing).floor() as u32;
    let num_sectors = (360.0 / angular_spacing_deg).round() as u32;
    let angle_step = 2.0 * PI / (num_sectors as f64);

    let cell_capacity = (num_sectors as usize) * (num_rings as usize);
    let mut cells: Vec<CellScore> = Vec::with_capacity(cell_capacity);
    let mut total_obstacles: u64 = 0;

    // Reuse the obstacles buffer across sectors — a small allocation
    // win on the hot path, but mostly it keeps the sort's temporary
    // storage warm.
    let mut obstacles: Vec<Obstacle> = Vec::new();

    for sector_index in 0..num_sectors {
        let theta_inner = (sector_index as f64) * angle_step;
        let mid_theta = theta_inner + angle_step / 2.0;
        let cos_mid = mid_theta.cos();
        let sin_mid = mid_theta.sin();

        // z=0 on both endpoints because
        // intersect_segment_building's ring math is 2D-only; the
        // returned `req` gets recomputed per-observer below with the
        // correct observer altitude, so nothing depends on the z here.
        let ray_start = Point3 { x: 0.0, y: 0.0, z: 0.0 };
        let ray_end = Point3 {
            x: analysis_radius * cos_mid,
            y: analysis_radius * sin_mid,
            z: 0.0,
        };

        obstacles.clear();

        // Buildings whose grid cells the ray passes through — superset
        // of the buildings the ray actually intersects (that's what
        // buildingIndex.query promises). Filter with the exact ring
        // math.
        let candidates = building_index.query(ray_start.x, ray_start.y, ray_end.x, ray_end.y);
        for idx in candidates {
            let bldg = &local_buildings[idx as usize];
            if let Some(hit) = intersect_segment_building(ray_start, ray_end, bldg) {
                // Use the observer-facing (exit / further-from-launch)
                // edge — see JS reference for why entry would give the
                // wrong req.
                obstacles.push(Obstacle {
                    distance: hit.t_exit * analysis_radius,
                    height: bldg.height,
                });
            }
        }

        // Terrain samples along the ray, if we have a grid. Skipping
        // `d < TERRAIN_STEP` avoids counting the launch pad itself as
        // an obstacle for observers just past it (would give absurd
        // req values). Increment via `d += TERRAIN_STEP` — same
        // floating-point trail JS produces, so per-sample distances
        // match bit-for-bit.
        if terrain.is_some() {
            let mut d = TERRAIN_STEP;
            while d <= analysis_radius {
                let x = d * cos_mid;
                let y = d * sin_mid;
                let (lat, lng) = projector.to_latlng(x, y);
                let elev = ground_elev(lng, lat);
                obstacles.push(Obstacle { distance: d, height: elev });
                d += TERRAIN_STEP;
            }
        }
        // Stable sort by distance so the inner loop can early-exit.
        // Rust's `sort_by` and JS's Array.prototype.sort are both
        // stable on tied keys, so obstacle iteration order matches.
        obstacles.sort_by(|a, b| a.distance.partial_cmp(&b.distance).unwrap());
        total_obstacles += obstacles.len() as u64;

        for ring_index in 0..num_rings {
            let r_inner = (ring_index as f64) * radial_spacing;
            let r_outer = r_inner + radial_spacing;
            let mid_r = (r_inner + r_outer) / 2.0;
            let obs_x = mid_r * cos_mid;
            let obs_y = mid_r * sin_mid;
            let (sample_lat, sample_lng) = projector.to_latlng(obs_x, obs_y);
            let cell_ground_elev = ground_elev(sample_lng, sample_lat);
            let observer_abs_alt = cell_ground_elev + EYE_HEIGHT;

            // req = observer + (h_B − observer) · midR / (midR − d_B)
            //   — the altitude the target has to sit at for the sightline
            //   to graze this obstacle's top from this observer's eye.
            let mut min_alt = f64::NEG_INFINITY;
            for obst in &obstacles {
                // Sorted → obstacles at/past the observer can't block.
                if obst.distance >= mid_r {
                    break;
                }
                let req = observer_abs_alt
                    + (obst.height - observer_abs_alt) * mid_r / (mid_r - obst.distance);
                if req > min_alt {
                    min_alt = req;
                }
            }

            let frac = fraction_visible(min_alt, target_abs_alt, shell_radius);
            let cell_score = composite_score(
                min_alt,
                target_abs_alt,
                shell_radius,
                observer_abs_alt,
                mid_r,
                1.0,
            );
            let height_diff = target_abs_alt - observer_abs_alt;
            let theta = apparent_angular_diameter_deg(mid_r, height_diff, shell_radius);
            let phi = elevation_angle_deg(mid_r, height_diff);
            let category = visibility_category(frac, comfort_factor(theta, phi));

            cells.push(CellScore { frac, score: cell_score, category });
        }
    }

    let avg_candidates = if num_sectors > 0 {
        (total_obstacles as f64) / (num_sectors as f64)
    } else {
        0.0
    };

    ViewshedResult {
        num_sectors,
        num_rings,
        avg_candidates,
        cells,
    }
}

// -- wasm entry -------------------------------------------------------------
//
// One export, one flat Vec<f64> in, one flat Vec<f64> out. Building
// footprints ride the same three-parallel-arrays layout C3 designed
// (heights f32, vertex_counts u32, vertex_data f64), reused verbatim
// so JS-side `packBuildings` produces the exact bytes this expects.
//
// Terrain rides as `has_terrain` flag + the 7 grid fields; pass zeros
// and an empty slice when there's no grid. wasm-bindgen doesn't have
// a clean Option<&[f32]> shape, and a sentinel flag is dead simple.

/// See module-doc for the output layout. Empty Vec on shape error.
#[wasm_bindgen(js_name = "computeViewshed")]
#[allow(clippy::too_many_arguments)]
pub fn compute_viewshed_wasm(
    launch_lat: f64,
    launch_lng: f64,
    target_height: f64,
    shell_radius: f64,
    analysis_radius: f64,
    radial_spacing: f64,
    angular_spacing_deg: f64,

    // Buildings — packed per C3's contract. Footprints are [lng, lat]
    // pairs here (raw normalized), heights are meters-above-base.
    heights: &[f32],
    vertex_counts: &[u32],
    vertex_data: &[f64],

    // Terrain grid: `has_terrain = 0` skips it entirely and the other
    // seven fields are ignored (so callers can pass zeros / empty).
    has_terrain: u32,
    terrain_data: &[f32],
    terrain_cells_x: u32,
    terrain_cells_y: u32,
    terrain_north_lat: f64,
    terrain_west_lng: f64,
    terrain_lat_step_deg: f64,
    terrain_lng_step_deg: f64,
) -> Vec<f64> {
    let buildings = match crate::marshaling::deserialize_buildings(
        heights,
        vertex_counts,
        vertex_data,
    ) {
        Ok(b) => b,
        Err(_) => return Vec::new(),
    };

    let terrain = if has_terrain != 0 {
        match crate::marshaling::deserialize_terrain(
            terrain_data,
            terrain_cells_x,
            terrain_cells_y,
            terrain_north_lat,
            terrain_west_lng,
            terrain_lat_step_deg,
            terrain_lng_step_deg,
        ) {
            Ok(g) => Some(g),
            Err(_) => return Vec::new(),
        }
    } else {
        None
    };

    let result = compute_viewshed_core(
        launch_lat,
        launch_lng,
        target_height,
        shell_radius,
        analysis_radius,
        radial_spacing,
        angular_spacing_deg,
        &buildings,
        terrain.as_ref(),
    );

    let mut out = Vec::with_capacity(1 + 3 * result.cells.len());
    out.push(result.avg_candidates);
    for cell in &result.cells {
        out.push(cell.frac);
        out.push(cell.score);
        out.push(cell.category as f64);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geo::Point2;

    // One tiny square building centered at (offset_lng, offset_lat) in
    // the SW quadrant of the analysis area, expressed in raw [lng, lat]
    // coords the core function accepts directly.
    fn square_bldg(center_lng: f64, center_lat: f64, half_deg: f64, height: f64) -> Building {
        let ring: Vec<Point2> = vec![
            [center_lng - half_deg, center_lat - half_deg],
            [center_lng + half_deg, center_lat - half_deg],
            [center_lng + half_deg, center_lat + half_deg],
            [center_lng - half_deg, center_lat + half_deg],
            [center_lng - half_deg, center_lat - half_deg],
        ];
        Building { footprint: vec![ring], height }
    }

    #[test]
    fn empty_scene_produces_expected_cell_count() {
        let out = compute_viewshed_core(
            40.7, -74.0, 100.0, 50.0,
            /*analysis*/ 100.0, /*radial*/ 20.0, /*angular*/ 60.0,
            &[], None,
        );
        assert_eq!(out.num_rings, 5); // 100 / 20
        assert_eq!(out.num_sectors, 6); // 360 / 60
        assert_eq!(out.cells.len(), 30);
        // No obstacles → avg_candidates = 0.
        assert_eq!(out.avg_candidates, 0.0);
    }

    #[test]
    fn no_obstacles_every_cell_is_fully_visible() {
        let out = compute_viewshed_core(
            40.7, -74.0, 200.0, 50.0,
            200.0, 20.0, 60.0,
            &[], None,
        );
        for cell in &out.cells {
            assert_eq!(cell.frac, 1.0, "expected fully-visible frac=1 with no obstacles");
        }
    }

    #[test]
    fn tall_building_blocks_a_downwind_cell() {
        // 60 sectors → sector 0 mid-θ = 3°, close enough to due east
        // that a building placed slightly east and north of the launch
        // sits under sector 0's ring 2 observer (~50 m east).
        //
        // Actually, easier to just prove SOMETHING gets blocked: put a
        // huge wall right next to launch, expect at least one cell's
        // frac to drop below 1.
        let wall = square_bldg(-74.0 + 0.0002, 40.7, 0.00005, 200.0);
        let out = compute_viewshed_core(
            40.7, -74.0, 5.0, 5.0,
            100.0, 20.0, 6.0,
            std::slice::from_ref(&wall),
            None,
        );
        let blocked = out.cells.iter().filter(|c| c.frac < 1.0).count();
        assert!(blocked > 0, "expected at least one blocked cell, got none");
    }
}

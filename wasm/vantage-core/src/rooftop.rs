// Direct Rust port of lib/viewshed/computeRooftopLayer.js — per-building
// visibility (as opposed to computeViewshed's per-grid-cell sweep).
//
// Same math end-to-end, but one deliberate deviation from the JS
// reference: the observer→target intersection pass here funnels
// candidates through `BuildingIndex`, whereas JS iterates every
// building unconditionally. The JS reference comments explicitly punt
// on the index because "6.5K outer × any inner is cheap"; that's
// wrong at scale — a Manhattan corridor with ~7K buildings drives
// ~5.5s (measured Sep 2026) through the JS path, because each outer
// call scans all buildings' footprint rings for exact segment×edge
// intersection. Using the index shrinks the inner scan to just the
// bbox-cells the sightline actually crosses (~100 buildings typical),
// and results stay byte-identical: the index is a strict superset
// filter that only removes buildings whose bbox provably can't
// contain any real edge crossing.
//
// Output layout (flat Vec<f64>): three values per building in input
// order — `[frac0, score0, cat0, frac1, score1, cat1, ...]`. Category
// codes: 0=blocked, 1=poor-angle, 2=partial, 3=good, 4=mixed.

use crate::building_index::BuildingIndex;
use crate::elevation_grid::ElevationGrid;
use crate::geo::{Building, Point2, Point3};
use crate::projector::LocalProjector;
use crate::scoring::{
    apparent_angular_diameter_deg, comfort_factor, elevation_angle_deg, fraction_visible,
    score as composite_score, visibility_category, EYE_HEIGHT,
};
use crate::sightline::intersect_segment_building;
use wasm_bindgen::prelude::*;

/// Category code for `mixed` — extension beyond scoring::visibility_category's
/// 0..=3 range. See computeRooftopLayer.js's block comment on why "mixed"
/// isn't reusing "partial" (they mean different things).
const CATEGORY_MIXED: u32 = 4;

/// A building whose bbox diagonal exceeds this gets extra samples near
/// its footprint corners. Below the threshold, the centroid alone
/// represents the whole rooftop. See JS reference for the tuning.
const LARGE_BUILDING_EXTENT_METERS: f64 = 40.0;

#[derive(Clone, Copy, Debug)]
pub struct RoofScore {
    pub frac: f64,
    pub score: f64,
    pub category: u32,
}

/// Bounding box of the outer ring in local meters. Same iteration
/// order as JS reference — one pass, tracked min/max.
fn footprint_bbox_ring(ring: &[Point2]) -> (f64, f64, f64, f64) {
    let mut min_x = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for pt in ring {
        if pt[0] < min_x { min_x = pt[0]; }
        if pt[0] > max_x { max_x = pt[0]; }
        if pt[1] < min_y { min_y = pt[1]; }
        if pt[1] > max_y { max_y = pt[1]; }
    }
    (min_x, min_y, max_x, max_y)
}

/// Return the ring vertex nearest to `point` (squared-distance, no sqrt).
fn nearest_vertex_to(ring: &[Point2], point: Point2) -> Point2 {
    let mut best = ring[0];
    let mut best_d2 = f64::INFINITY;
    for &v in ring {
        let dx = v[0] - point[0];
        let dy = v[1] - point[1];
        let d2 = dx * dx + dy * dy;
        if d2 < best_d2 {
            best_d2 = d2;
            best = v;
        }
    }
    best
}

/// Extra sample points for a "large" building — real footprint
/// vertices near each bbox corner, deduped by coordinate identity.
/// Returns empty for buildings under the size threshold.
///
/// The dedup uses exact-equality bit patterns (via `f64::to_bits`) so
/// two calls to `nearest_vertex_to` that pick the same vertex don't
/// yield duplicates. Matches JS reference's string-key dedup exactly.
fn extra_sample_points(ring: &[Point2]) -> Vec<Point2> {
    let (min_x, min_y, max_x, max_y) = footprint_bbox_ring(ring);
    let diag = ((max_x - min_x).powi(2) + (max_y - min_y).powi(2)).sqrt();
    if diag <= LARGE_BUILDING_EXTENT_METERS {
        return Vec::new();
    }
    let corners = [
        [min_x, min_y],
        [max_x, min_y],
        [max_x, max_y],
        [min_x, max_y],
    ];
    let mut seen: Vec<(u64, u64)> = Vec::with_capacity(4);
    let mut points: Vec<Point2> = Vec::with_capacity(4);
    for corner in corners {
        let v = nearest_vertex_to(ring, corner);
        let key = (v[0].to_bits(), v[1].to_bits());
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        points.push(v);
    }
    points
}

/// Ring centroid — plain average of vertices, excluding the closing
/// duplicate. Same "not the true polygon centroid" caveat as JS.
/// Input ring is raw [lng, lat] pairs.
fn ring_centroid_latlng(ring: &[Point2]) -> (f64, f64) {
    let verts = &ring[..ring.len() - 1];
    let mut sum_lng = 0.0;
    let mut sum_lat = 0.0;
    for pt in verts {
        sum_lng += pt[0];
        sum_lat += pt[1];
    }
    let n = verts.len() as f64;
    (sum_lng / n, sum_lat / n)
}

/// Compute the minimum target altitude required to be seen over any
/// building crossing observer→target. Same as sightline::compute_min_alt
/// but scoped to the index-filtered candidate list — a strict superset
/// of the buildings the segment could actually intersect, so results
/// stay identical to the brute-force version.
fn compute_min_alt_indexed(
    observer: Point3,
    target: Point3,
    buildings: &[Building],
    index: &BuildingIndex,
) -> f64 {
    let mut min_alt = f64::NEG_INFINITY;
    let candidates = index.query(observer.x, observer.y, target.x, target.y);
    for idx in candidates {
        let bldg = &buildings[idx as usize];
        if let Some(hit) = intersect_segment_building(observer, target, bldg) {
            if hit.req > min_alt {
                min_alt = hit.req;
            }
        }
    }
    min_alt
}

/// Pure Rust rooftop layer. Buildings arrive with footprints in
/// [lng, lat] pairs and heights meters-above-base (matching the raw
/// normalized shape JS `computeRooftopLayer` accepts).
///
/// Output order: same as input order — the JS side attaches
/// `footprint` / `buildingHeight` / metadata by index after unpacking.
pub fn compute_rooftop_layer_core(
    launch_lat: f64,
    launch_lng: f64,
    target_height: f64,
    shell_radius: f64,
    buildings_latlng: &[Building],
    terrain: Option<&ElevationGrid>,
) -> Vec<RoofScore> {
    let projector = LocalProjector::new(launch_lat, launch_lng);
    let ground_elev = |lng: f64, lat: f64| -> f64 {
        terrain.and_then(|g| g.get_elevation(lng, lat)).unwrap_or(0.0)
    };

    let launch_elev = ground_elev(launch_lng, launch_lat);
    let target_abs_alt = launch_elev + target_height;
    let target = Point3 { x: 0.0, y: 0.0, z: target_abs_alt };

    // Pre-compute each building's centroid + ground elevation + local
    // footprint. One pass — the observer loop below reads these back by
    // index rather than recomputing, and the resulting Vec<Building>
    // doubles as both "occluder set" and "observer positions."
    let n = buildings_latlng.len();
    let mut local_buildings: Vec<Building> = Vec::with_capacity(n);
    let mut bldg_ground_elevs: Vec<f64> = Vec::with_capacity(n);
    let mut centroids_local: Vec<Point2> = Vec::with_capacity(n);
    for b in buildings_latlng {
        let ring = &b.footprint[0];
        let (centroid_lng, centroid_lat) = ring_centroid_latlng(ring);
        let bldg_ground_elev = ground_elev(centroid_lng, centroid_lat);
        // Project every ring into local meters. Only the outer ring
        // matters for sightline math, but we keep the shape symmetric
        // with the JS reference so subsequent readers see the same
        // structure.
        let projected: Vec<Vec<Point2>> = b
            .footprint
            .iter()
            .map(|ring2| {
                ring2
                    .iter()
                    .map(|pt| {
                        let (x, y) = projector.to_local(pt[1], pt[0]);
                        [x, y]
                    })
                    .collect()
            })
            .collect();
        let (cx, cy) = projector.to_local(centroid_lat, centroid_lng);
        centroids_local.push([cx, cy]);
        bldg_ground_elevs.push(bldg_ground_elev);
        local_buildings.push(Building {
            footprint: projected,
            height: bldg_ground_elev + b.height,
        });
    }

    let index = BuildingIndex::build(&local_buildings);

    let mut out: Vec<RoofScore> = Vec::with_capacity(n);
    for i in 0..n {
        let b_raw = &buildings_latlng[i];
        let [cx, cy] = centroids_local[i];
        let observer_abs_alt = bldg_ground_elevs[i] + b_raw.height + EYE_HEIGHT;
        let observer = Point3 { x: cx, y: cy, z: observer_abs_alt };

        // computeMinAlt equivalent — the observer's own building sits
        // (~centroid) inside itself, so intersect_segment_building's
        // "needs 2 edge crossings" invariant naturally rejects the
        // self-hit. No explicit filter needed.
        let min_alt = compute_min_alt_indexed(observer, target, &local_buildings, &index);
        let frac = fraction_visible(min_alt, target_abs_alt, shell_radius);

        let horizontal_distance = (cx * cx + cy * cy).sqrt();
        let height_diff = target_abs_alt - observer_abs_alt;
        let theta = apparent_angular_diameter_deg(horizontal_distance, height_diff, shell_radius);
        let phi = elevation_angle_deg(horizontal_distance, height_diff);
        let cell_score = composite_score(
            min_alt,
            target_abs_alt,
            shell_radius,
            observer_abs_alt,
            horizontal_distance,
            1.0,
        );
        let mut category = visibility_category(frac, comfort_factor(theta, phi));

        // Large-building disagreement check. Only fires for buildings
        // past LARGE_BUILDING_EXTENT_METERS diagonal, so it's a no-op
        // for the ~90% of rowhouses/small buildings. When it fires,
        // adds a handful of extra `compute_min_alt_indexed` calls per
        // large building — index-filtered again, so still cheap.
        let outer_ring = &local_buildings[i].footprint[0];
        let extra = extra_sample_points(outer_ring);
        if !extra.is_empty() {
            let centroid_blocked = frac < 0.15; // isBlocked's threshold — see scoring.js
            for pt in &extra {
                let sample_obs = Point3 {
                    x: pt[0],
                    y: pt[1],
                    z: observer_abs_alt,
                };
                let sample_min_alt =
                    compute_min_alt_indexed(sample_obs, target, &local_buildings, &index);
                let sample_frac = fraction_visible(sample_min_alt, target_abs_alt, shell_radius);
                let sample_blocked = sample_frac < 0.15;
                if sample_blocked != centroid_blocked {
                    category = CATEGORY_MIXED;
                    break;
                }
            }
        }

        out.push(RoofScore { frac, score: cell_score, category });
    }
    out
}

// -- wasm entry -------------------------------------------------------------

/// Per-building rooftop scores. Buildings ride the same three-array
/// packing as computeViewshed; terrain rides the same 7-scalars +
/// has_terrain flag pattern. Output is a flat Float64Array of length
/// `3 * num_buildings`.
#[wasm_bindgen(js_name = "computeRooftopLayer")]
#[allow(clippy::too_many_arguments)]
pub fn compute_rooftop_layer_wasm(
    launch_lat: f64,
    launch_lng: f64,
    target_height: f64,
    shell_radius: f64,

    heights: &[f32],
    vertex_counts: &[u32],
    vertex_data: &[f64],

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
        heights, vertex_counts, vertex_data,
    ) {
        Ok(b) => b,
        Err(_) => return Vec::new(),
    };

    let terrain = if has_terrain != 0 {
        match crate::marshaling::deserialize_terrain(
            terrain_data, terrain_cells_x, terrain_cells_y,
            terrain_north_lat, terrain_west_lng,
            terrain_lat_step_deg, terrain_lng_step_deg,
        ) {
            Ok(g) => Some(g),
            Err(_) => return Vec::new(),
        }
    } else {
        None
    };

    let scores = compute_rooftop_layer_core(
        launch_lat, launch_lng, target_height, shell_radius,
        &buildings, terrain.as_ref(),
    );

    let mut out = Vec::with_capacity(3 * scores.len());
    for s in &scores {
        out.push(s.frac);
        out.push(s.score);
        out.push(s.category as f64);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny_bldg(center_lng: f64, center_lat: f64, half_deg: f64, height: f64) -> Building {
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
    fn empty_scene_returns_empty() {
        let out = compute_rooftop_layer_core(40.7, -74.0, 100.0, 50.0, &[], None);
        assert!(out.is_empty());
    }

    #[test]
    fn each_building_gets_one_score() {
        let bldgs = vec![
            tiny_bldg(-74.001, 40.700, 0.00003, 20.0),
            tiny_bldg(-74.002, 40.701, 0.00003, 30.0),
            tiny_bldg(-74.003, 40.702, 0.00003, 15.0),
        ];
        let out = compute_rooftop_layer_core(40.7, -74.0, 300.0, 50.0, &bldgs, None);
        assert_eq!(out.len(), 3);
        for s in &out {
            assert!(s.category <= CATEGORY_MIXED);
        }
    }

    #[test]
    fn tall_building_between_two_shorter_rooftops_can_block_one() {
        // Small: two short rooftops close together; a tall wall
        // between one of them and the launch. Prove at least one
        // rooftop registers a frac below 1.
        let wall = tiny_bldg(-74.0002, 40.700, 0.00005, 200.0);
        let short_a = tiny_bldg(-74.0004, 40.700, 0.00003, 10.0);
        let short_b = tiny_bldg(-74.0001, 40.700, 0.00003, 10.0);
        let bldgs = vec![short_a, wall, short_b];
        let out = compute_rooftop_layer_core(40.7, -74.0, 5.0, 5.0, &bldgs, None);
        let blocked_count = out.iter().filter(|s| s.frac < 1.0).count();
        assert!(blocked_count > 0, "expected at least one rooftop to be occluded");
    }
}

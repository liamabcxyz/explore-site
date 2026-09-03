// Direct Rust port of lib/viewshed/computeProfile.js's
// computeSightlineProfile — the per-click "why is this point
// blocked / clear" analysis. One observer, one launch, every
// building the sightline crosses (in distance order), plus the
// sampled terrain profile between them.
//
// Unlike computeViewshed / computeRooftopLayer this runs once per
// user click, not per building or per grid cell — so raw wall time
// is already low (~10-50 ms in JS on typical inputs). The reason to
// port anyway is completeness: `?impl=wasm` should route every
// compute through Rust so the Cloudflare-Workers migration in
// planning has a clean cutover story, and having the Rust half in
// the tree unblocks the JS/WASM tree-shake that will drop the
// duplicated JS sightline math later.
//
// Same one deviation from the JS reference as the rooftop port: use
// BuildingIndex to shrink the intersection scan from "every building"
// to "buildings whose bbox cells the sightline crosses." Byte-identical
// output — the index is a strict superset filter — but ~50-100×
// fewer intersect calls on a typical corridor.
//
// Output layout — one flat Vec<f64> for the whole result. See the
// wasm-entry doc-comment below for the byte-for-byte header spec.

use crate::building_index::BuildingIndex;
use crate::curvature::apparent_altitude;
use crate::elevation_grid::ElevationGrid;
use crate::geo::{Building, Point2, Point3};
use crate::projector::LocalProjector;
use crate::scoring::{
    apparent_angular_diameter_deg, comfort_factor, elevation_angle_deg, fraction_visible,
    score as composite_score, visibility_category,
};
use crate::sightline::intersect_segment_building;
use wasm_bindgen::prelude::*;

/// Distance below which the curvature lift is a no-op — matches the
/// JS reference. Inside 1.5 km the drop is <0.3 m, dwarfed by
/// building-height noise; leaving it off keeps the pre-Phase-5
/// short-range fixtures byte-identical.
const CURVATURE_MIN_METERS: f64 = 2000.0;

/// Terrain sample step along observer→target. Same 20 m as
/// computeViewshed's per-ray terrain walk.
const TERRAIN_STEP: f64 = 20.0;

#[derive(Clone, Copy, Debug)]
pub struct ProfileHit {
    /// Index back into the caller's buildings array — the JS side
    /// re-attaches `name`, `confidence`, `footprint` by index.
    pub building_index: u32,
    pub distance: f64,
    pub req: f64,
    /// Absolute-altitude roofline (terrain + building.height) so the
    /// UI's "51 m building" label doesn't need a second terrain lookup.
    pub abs_height: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct TerrainSample {
    pub distance: f64,
    pub elevation: f64,
}

pub struct SightlineProfile {
    pub total_distance: f64,
    pub launch_elev: f64,
    pub observer_ground_elev: f64,
    pub observer_abs_alt: f64,
    pub target_abs_alt: f64,
    pub target_apparent_alt: f64,
    pub min_alt: f64,
    pub frac: f64,
    pub theta: f64,
    pub phi: f64,
    pub score: f64,
    pub category: u32,
    /// Sorted by distance ascending, matching JS reference.
    pub hits: Vec<ProfileHit>,
    /// Two endpoints minimum when total_distance > 0, else empty.
    pub terrain_profile: Vec<TerrainSample>,
}

#[inline]
fn lift(asl: f64, distance: f64, total_distance: f64) -> f64 {
    if total_distance >= CURVATURE_MIN_METERS {
        apparent_altitude(asl, distance)
    } else {
        asl
    }
}

/// Pure Rust port. Buildings arrive as raw normalized (footprints
/// [lng, lat], heights meters-above-base); the projection + terrain
/// lift + intersection happen here so the parity check covers all of it.
#[allow(clippy::too_many_arguments)]
pub fn compute_sightline_profile_core(
    launch_lat: f64,
    launch_lng: f64,
    observer_lat: f64,
    observer_lng: f64,
    target_height: f64,
    shell_radius: f64,
    observer_height: f64,
    buildings_latlng: &[Building],
    terrain: Option<&ElevationGrid>,
) -> SightlineProfile {
    let projector = LocalProjector::new(launch_lat, launch_lng);
    let ground_elev = |lng: f64, lat: f64| -> f64 {
        terrain.and_then(|g| g.get_elevation(lng, lat)).unwrap_or(0.0)
    };

    let launch_elev = ground_elev(launch_lng, launch_lat);
    let observer_ground_elev = ground_elev(observer_lng, observer_lat);
    let target_abs_alt = launch_elev + target_height;
    let observer_abs_alt = observer_ground_elev + observer_height;

    let target = Point3 { x: 0.0, y: 0.0, z: target_abs_alt };
    let (obs_x, obs_y) = projector.to_local(observer_lat, observer_lng);
    let obs = Point3 { x: obs_x, y: obs_y, z: observer_abs_alt };

    let dx = target.x - obs.x;
    let dy = target.y - obs.y;
    let total_distance = (dx * dx + dy * dy).sqrt();

    // Same one-pass build as rooftop: project every footprint and
    // capture the terrain-lifted absolute-altitude roofline. We keep
    // the raw building heights alongside so `hits[i].abs_height` can
    // be reported without re-doing the centroid lookup.
    let n = buildings_latlng.len();
    let mut local_buildings: Vec<Building> = Vec::with_capacity(n);
    for b in buildings_latlng {
        let ring = &b.footprint[0];
        let verts = &ring[..ring.len() - 1];
        let mut sum_lng = 0.0;
        let mut sum_lat = 0.0;
        for pt in verts {
            sum_lng += pt[0];
            sum_lat += pt[1];
        }
        let centroid_lng = sum_lng / verts.len() as f64;
        let centroid_lat = sum_lat / verts.len() as f64;
        let bldg_ground_elev = ground_elev(centroid_lng, centroid_lat);
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
        local_buildings.push(Building {
            footprint: projected,
            height: bldg_ground_elev + b.height,
        });
    }

    // Deviation from JS: use BuildingIndex to prune before intersection.
    // Same result — index is a strict superset filter.
    let index = BuildingIndex::build(&local_buildings);

    let mut hits: Vec<ProfileHit> = Vec::new();
    if total_distance > 0.0 {
        let candidates = index.query(obs.x, obs.y, target.x, target.y);
        for idx in candidates {
            let bldg = &local_buildings[idx as usize];
            if let Some(hit) = intersect_segment_building(obs, target, bldg) {
                let distance = hit.t_entry * total_distance;
                // Recompute req in the curvature-corrected frame so a
                // long sightline isn't systematically optimistic; the
                // hit's abs_height stays raw ASL so the UI label reads
                // "the building's actual height."
                let bldg_apparent = lift(bldg.height, distance, total_distance);
                let req = observer_abs_alt + (bldg_apparent - observer_abs_alt) / hit.t_entry;
                hits.push(ProfileHit {
                    building_index: idx,
                    distance,
                    req,
                    abs_height: bldg.height,
                });
            }
        }
        hits.sort_by(|a, b| a.distance.partial_cmp(&b.distance).unwrap());
    }

    // Terrain profile — always include endpoints plus 20m samples in
    // between. terrainMaxReq only folds in when a real grid is
    // present (empty-grid fallback would inject spurious 0m samples
    // that pull minAlt away from its -Inf "no obstacles" sentinel).
    let mut terrain_profile: Vec<TerrainSample> = Vec::new();
    let mut terrain_max_req = f64::NEG_INFINITY;
    if total_distance > 0.0 {
        let dir_x = dx / total_distance;
        let dir_y = dy / total_distance;
        // Match JS: `for (d = 0; d <= total; d += STEP)` accumulating
        // FP error the same way, then append total if the last sample
        // didn't already land exactly there.
        let mut distances: Vec<f64> = Vec::new();
        let mut d = 0.0;
        while d <= total_distance {
            distances.push(d);
            d += TERRAIN_STEP;
        }
        if let Some(&last) = distances.last() {
            if last < total_distance {
                distances.push(total_distance);
            }
        }
        for d in distances {
            let x = obs.x + dir_x * d;
            let y = obs.y + dir_y * d;
            let (lat, lng) = projector.to_latlng(x, y);
            let elev = ground_elev(lng, lat);
            terrain_profile.push(TerrainSample { distance: d, elevation: elev });
            if terrain.is_none() {
                continue;
            }
            // Skip endpoints (near observer / near launch pad) — the
            // "d < 5" and "d > total - 5" bounds match JS reference.
            if d < 5.0 || d > total_distance - 5.0 {
                continue;
            }
            let t = d / total_distance;
            let elev_apparent = lift(elev, d, total_distance);
            let req = observer_abs_alt + (elev_apparent - observer_abs_alt) / t;
            if req > terrain_max_req {
                terrain_max_req = req;
            }
        }
    }

    let hit_max_req = hits.iter().fold(f64::NEG_INFINITY, |acc, h| acc.max(h.req));
    let min_alt = hit_max_req.max(terrain_max_req);
    let target_apparent_alt = lift(target_abs_alt, total_distance, total_distance);
    let frac = fraction_visible(min_alt, target_apparent_alt, shell_radius);

    let height_diff = target_apparent_alt - observer_abs_alt;
    let theta = apparent_angular_diameter_deg(total_distance, height_diff, shell_radius);
    let phi = elevation_angle_deg(total_distance, height_diff);
    let cell_score = composite_score(
        min_alt,
        target_apparent_alt,
        shell_radius,
        observer_abs_alt,
        total_distance,
        1.0,
    );
    let category = visibility_category(frac, comfort_factor(theta, phi));

    SightlineProfile {
        total_distance,
        launch_elev,
        observer_ground_elev,
        observer_abs_alt,
        target_abs_alt,
        target_apparent_alt,
        min_alt,
        frac,
        theta,
        phi,
        score: cell_score,
        category,
        hits,
        terrain_profile,
    }
}

// -- wasm entry -------------------------------------------------------------

/// Header size (in f64 slots) of the flat output — kept as a constant
/// so both sides can index by name-derived offsets rather than magic
/// numbers, and any header expansion updates one place.
const PROFILE_HEADER_LEN: usize = 14;

/// Compute a sightline profile.
///
/// Buildings ride the same three-array packing as computeViewshed /
/// computeRooftopLayer; terrain rides the same 7-scalars + `has_terrain`
/// flag. `observer_height` is the observer's height above their
/// ground (matches JS's default of EYE_HEIGHT = 1.6 when unset).
///
/// Return format — one flat Float64Array:
///
/// ```text
/// [0..14):  header
///   0  total_distance
///   1  launch_elev
///   2  observer_ground_elev
///   3  observer_abs_alt
///   4  target_abs_alt
///   5  target_apparent_alt
///   6  min_alt              (-Infinity when no blockers)
///   7  frac
///   8  theta
///   9  phi
///   10 score
///   11 category              (0=blocked, 1=poor-angle, 2=partial, 3=good)
///   12 num_hits
///   13 num_terrain_points
///
/// [14 .. 14 + 4*num_hits):    hits, each = [bldg_idx, distance, req, abs_height]
/// [ .. + 2*num_terrain_points): terrain samples, each = [distance, elevation]
/// ```
///
/// Empty Vec on shape error from the marshaling layer.
#[wasm_bindgen(js_name = "computeSightlineProfile")]
#[allow(clippy::too_many_arguments)]
pub fn compute_sightline_profile_wasm(
    launch_lat: f64,
    launch_lng: f64,
    observer_lat: f64,
    observer_lng: f64,
    target_height: f64,
    shell_radius: f64,
    observer_height: f64,

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

    let p = compute_sightline_profile_core(
        launch_lat, launch_lng,
        observer_lat, observer_lng,
        target_height, shell_radius, observer_height,
        &buildings, terrain.as_ref(),
    );

    let num_hits = p.hits.len();
    let num_terrain = p.terrain_profile.len();
    let mut out = Vec::with_capacity(PROFILE_HEADER_LEN + 4 * num_hits + 2 * num_terrain);
    out.push(p.total_distance);
    out.push(p.launch_elev);
    out.push(p.observer_ground_elev);
    out.push(p.observer_abs_alt);
    out.push(p.target_abs_alt);
    out.push(p.target_apparent_alt);
    out.push(p.min_alt);
    out.push(p.frac);
    out.push(p.theta);
    out.push(p.phi);
    out.push(p.score);
    out.push(p.category as f64);
    out.push(num_hits as f64);
    out.push(num_terrain as f64);
    for h in &p.hits {
        out.push(h.building_index as f64);
        out.push(h.distance);
        out.push(h.req);
        out.push(h.abs_height);
    }
    for s in &p.terrain_profile {
        out.push(s.distance);
        out.push(s.elevation);
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
    fn empty_scene_flat_ground_full_visibility() {
        let p = compute_sightline_profile_core(
            40.7, -74.0, 40.705, -74.0,
            100.0, 20.0, 1.6,
            &[], None,
        );
        assert!(p.total_distance > 0.0);
        // No obstacles → min_alt is -Infinity, frac=1.
        assert_eq!(p.frac, 1.0);
        assert!(p.hits.is_empty());
        // terrain_profile always has at least two endpoints when
        // total_distance > 0.
        assert!(p.terrain_profile.len() >= 2);
    }

    #[test]
    fn observer_on_launch_yields_zero_distance() {
        let p = compute_sightline_profile_core(
            40.7, -74.0, 40.7, -74.0,
            100.0, 20.0, 1.6,
            &[], None,
        );
        assert_eq!(p.total_distance, 0.0);
        assert!(p.terrain_profile.is_empty());
        assert!(p.hits.is_empty());
    }

    #[test]
    fn tall_wall_between_observer_and_launch_registers_hit() {
        // Launch at (40.7, -74.0), observer 100m north. Wall between
        // them (50m north of launch), tall enough to block.
        let wall = tiny_bldg(-74.0, 40.70045, 0.0001, 200.0);
        let p = compute_sightline_profile_core(
            40.7, -74.0, 40.7009, -74.0,
            5.0, 5.0, 1.6,
            std::slice::from_ref(&wall),
            None,
        );
        assert!(!p.hits.is_empty(), "wall should register a hit");
        assert!(p.frac < 1.0, "wall should block some of the shell");
    }
}

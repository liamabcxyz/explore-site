// Direct Rust port of lib/viewshed/sightline.js.
//
// Core 2.5D line-of-sight blockage math. Operates entirely in local
// meters (x, y horizontal, z vertical) — callers project WGS84 via
// `LocalProjector` before calling in here.

use crate::geo::{Building, Point3};
use wasm_bindgen::prelude::*;

/// Result of a line segment × line segment intersection in 2D.
/// `t` parameterizes the first segment (0..1 inside), `u` the second.
struct SegHit {
    t: f64,
    u: f64,
}

fn segment_intersection(
    p1x: f64, p1y: f64, p2x: f64, p2y: f64,
    p3x: f64, p3y: f64, p4x: f64, p4y: f64,
) -> Option<SegHit> {
    let d1x = p2x - p1x;
    let d1y = p2y - p1y;
    let d2x = p4x - p3x;
    let d2y = p4y - p3y;
    let denom = d1x * d2y - d1y * d2x;
    if denom.abs() < 1e-12 {
        return None;
    }
    let dx = p3x - p1x;
    let dy = p3y - p1y;
    let t = (dx * d2y - dy * d2x) / denom;
    let u = (dx * d1y - dy * d1x) / denom;
    Some(SegHit { t, u })
}

#[derive(Clone, Copy, Debug)]
pub struct SegmentBuildingHit {
    pub t_entry: f64,
    pub t_exit: f64,
    pub req: f64,
}

/// Segment (observer → target) × building footprint intersection.
/// Returns None if the segment doesn't clip through the building's
/// exterior ring (or only touches at the endpoints). See JS reference
/// for the `req = z0 + (h - z0)/tEntry` derivation.
pub fn intersect_segment_building(
    observer: Point3,
    target: Point3,
    building: &Building,
) -> Option<SegmentBuildingHit> {
    let ring = &building.footprint[0];
    // The ring is closed (first == last), so we iterate 0..len-1 edges.
    let n = ring.len();
    if n < 3 { return None; }
    // Track min/max t as we go — avoids allocating a Vec of hits.
    let mut t_entry = f64::INFINITY;
    let mut t_exit = f64::NEG_INFINITY;
    let mut hits = 0u32;
    for i in 0..(n - 1) {
        let a = ring[i];
        let b = ring[i + 1];
        if let Some(hit) = segment_intersection(
            observer.x, observer.y, target.x, target.y,
            a[0], a[1], b[0], b[1],
        ) {
            if hit.u >= 0.0 && hit.u <= 1.0 && hit.t >= 0.0 && hit.t <= 1.0 {
                hits += 1;
                if hit.t < t_entry { t_entry = hit.t; }
                if hit.t > t_exit  { t_exit  = hit.t; }
            }
        }
    }
    if hits < 2 { return None; }
    if t_entry <= 0.0 || t_entry >= 1.0 { return None; }
    let req = observer.z + (building.height - observer.z) / t_entry;
    Some(SegmentBuildingHit { t_entry, t_exit, req })
}

/// Max `req` over every building intersecting observer→target.
/// `-Infinity` (nothing blocks) is deliberate — see JS reference.
pub fn compute_min_alt(observer: Point3, target: Point3, buildings: &[Building]) -> f64 {
    let mut min_alt = f64::NEG_INFINITY;
    for building in buildings {
        if let Some(hit) = intersect_segment_building(observer, target, building) {
            if hit.req > min_alt {
                min_alt = hit.req;
            }
        }
    }
    min_alt
}

// -- test-only wasm exports -------------------------------------------------
// A single-building version of intersect_segment_building for the JS-side
// self-check. Footprint is passed as a flat Float64Array of alternating
// x,y coords — the same packing shape C3 will use for the real compute.
// Returns [tEntry, tExit, req] packed as 3 f64s, or all-NaN when no hit.

#[wasm_bindgen(js_name = "intersectSegmentBuildingFlat")]
pub fn intersect_segment_building_flat(
    ox: f64, oy: f64, oz: f64,
    tx: f64, ty: f64, tz: f64,
    footprint_xy: &[f64],   // exterior ring only, flat [x0,y0,x1,y1,...]
    height: f64,
) -> Vec<f64> {
    let mut ring = Vec::with_capacity(footprint_xy.len() / 2);
    let mut i = 0;
    while i + 1 < footprint_xy.len() {
        ring.push([footprint_xy[i], footprint_xy[i + 1]]);
        i += 2;
    }
    let building = Building { footprint: vec![ring], height };
    let observer = Point3 { x: ox, y: oy, z: oz };
    let target = Point3 { x: tx, y: ty, z: tz };
    match intersect_segment_building(observer, target, &building) {
        Some(h) => vec![h.t_entry, h.t_exit, h.req],
        None => vec![f64::NAN, f64::NAN, f64::NAN],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // Simple square building centered at (5, 0), 2×2, height 20.
    fn square_bldg() -> Building {
        Building {
            footprint: vec![vec![
                [4.0, -1.0], [6.0, -1.0], [6.0, 1.0], [4.0, 1.0], [4.0, -1.0],
            ]],
            height: 20.0,
        }
    }

    #[test]
    fn ray_through_building_returns_req() {
        let obs = Point3 { x: 0.0, y: 0.0, z: 1.6 };
        let tgt = Point3 { x: 10.0, y: 0.0, z: 100.0 };
        let hit = intersect_segment_building(obs, tgt, &square_bldg()).unwrap();
        // Entry at x=4 → tEntry = 4/10 = 0.4.
        assert!((hit.t_entry - 0.4).abs() < 1e-12);
        assert!((hit.t_exit  - 0.6).abs() < 1e-12);
        // req = 1.6 + (20 - 1.6) / 0.4 = 1.6 + 46 = 47.6
        assert!((hit.req - 47.6).abs() < 1e-12);
    }

    #[test]
    fn ray_missing_building_returns_none() {
        let obs = Point3 { x: 0.0, y: 5.0, z: 1.6 };
        let tgt = Point3 { x: 10.0, y: 5.0, z: 100.0 };
        assert!(intersect_segment_building(obs, tgt, &square_bldg()).is_none());
    }

    #[test]
    fn ray_ending_at_edge_treated_as_no_hit() {
        // tEntry == 1.0 → JS rejects; Rust matches.
        let obs = Point3 { x: 0.0, y: 0.0, z: 1.6 };
        let tgt = Point3 { x: 4.0, y: 0.0, z: 100.0 };
        // The ray goes to x=4 exactly, which is the entry edge.
        // Only one edge intersection; hits < 2 → None.
        assert!(intersect_segment_building(obs, tgt, &square_bldg()).is_none());
    }

    #[test]
    fn compute_min_alt_max_over_buildings() {
        let obs = Point3 { x: 0.0, y: 0.0, z: 1.6 };
        let tgt = Point3 { x: 10.0, y: 0.0, z: 100.0 };
        let b1 = square_bldg();               // req 47.6
        let mut b2 = square_bldg();           // taller: req scales linearly
        b2.height = 40.0;                     // req = 1.6 + (40-1.6)/0.4 = 97.6
        let m = compute_min_alt(obs, tgt, &[b1, b2]);
        assert!((m - 97.6).abs() < 1e-12);
    }
}

// Shared geometry types used across sightline / building_index modules.
// All coordinates are in the observer/launch-local flat-meters frame —
// callers project WGS84 → local meters via `LocalProjector` before
// entering here.

pub type Point2 = [f64; 2]; // [x, y]

#[derive(Clone, Copy, Debug)]
pub struct Point3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

/// One building in local meters. `footprint[0]` is the exterior ring;
/// hole rings are ignored by sightline math (a courtyard doesn't stop a
/// sightline through the building's mass). Each ring is closed — first
/// vertex equals the last — matching the GeoJSON convention the JS
/// pipeline already produces.
///
/// `height` is absolute meters above the local-meters z=0 baseline
/// (which is the launch point's ground elevation) — terrain + building
/// height have already been folded in upstream, matching the JS
/// `localBuildings` structure post-Phase-3 terrain integration.
#[derive(Clone, Debug)]
pub struct Building {
    pub footprint: Vec<Vec<Point2>>,
    pub height: f64,
}

/// Axis-aligned bounding box in local meters.
#[derive(Clone, Copy, Debug)]
pub struct BBox {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

pub fn footprint_bbox(footprint: &[Vec<Point2>]) -> BBox {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for ring in footprint {
        for pt in ring {
            if pt[0] < min_x { min_x = pt[0]; }
            if pt[0] > max_x { max_x = pt[0]; }
            if pt[1] < min_y { min_y = pt[1]; }
            if pt[1] > max_y { max_y = pt[1]; }
        }
    }
    BBox { min_x, min_y, max_x, max_y }
}

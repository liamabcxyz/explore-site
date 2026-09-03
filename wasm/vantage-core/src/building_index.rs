// Direct Rust port of lib/viewshed/buildingIndex.js.
//
// Same 2D DDA walk (Amanatides & Woo style) that visits every cell a
// segment's line passes through — including both cells at an exact
// diagonal grid crossing, which a naive Bresenham skips. Buildings are
// registered into every cell their footprint bbox overlaps, so as long
// as the traversal never skips a cell the segment passes through, no
// candidate blocker is missed.

use crate::geo::{footprint_bbox, Building};
use std::collections::HashMap;

const DEFAULT_CELL_SIZE_METERS: f64 = 50.0;

/// Spatial index bucket key. Small tuple beats string concat + hash on
/// the hot path (called on every sector's building lookup, thousands of
/// keys per analysis).
type CellKey = (i32, i32);

pub struct BuildingIndex {
    pub cell_size: f64,
    /// bucket → list of building indices (into the caller's slice), not
    /// owned buildings, so a query returns cheap Copy indices rather than
    /// cloning footprints.
    buckets: HashMap<CellKey, Vec<u32>>,
}

impl BuildingIndex {
    pub fn build(buildings: &[Building]) -> Self {
        Self::build_with_cell_size(buildings, DEFAULT_CELL_SIZE_METERS)
    }

    pub fn build_with_cell_size(buildings: &[Building], cell_size: f64) -> Self {
        let mut buckets: HashMap<CellKey, Vec<u32>> = HashMap::new();
        for (idx, b) in buildings.iter().enumerate() {
            let bbox = footprint_bbox(&b.footprint);
            let cell_min_x = (bbox.min_x / cell_size).floor() as i32;
            let cell_max_x = (bbox.max_x / cell_size).floor() as i32;
            let cell_min_y = (bbox.min_y / cell_size).floor() as i32;
            let cell_max_y = (bbox.max_y / cell_size).floor() as i32;
            for cx in cell_min_x..=cell_max_x {
                for cy in cell_min_y..=cell_max_y {
                    buckets.entry((cx, cy)).or_default().push(idx as u32);
                }
            }
        }
        Self { cell_size, buckets }
    }

    /// Grid walk from (x0, y0) to (x1, y1), returning the deduped list
    /// of building indices in every bucket the segment's line passes
    /// through. Superset of true blockers — call `intersect_segment_building`
    /// to filter exactly.
    pub fn query(&self, x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<u32> {
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for (cx, cy) in walk_grid_cells(x0, y0, x1, y1, self.cell_size) {
            if let Some(bucket) = self.buckets.get(&(cx, cy)) {
                for &idx in bucket {
                    if seen.insert(idx) {
                        out.push(idx);
                    }
                }
            }
        }
        out
    }
}

/// Gapless 2D DDA walk from (x0, y0) to (x1, y1) — visits every cell
/// the segment's line passes through, including a cell it only grazes
/// at a corner. See JS reference for the diagonal-crossing subtlety.
///
/// Returns integer cell coordinates. Length bounded by Manhattan
/// distance + 4 slack, matching the JS `maxSteps` guard against
/// floating-point termination edge cases.
pub fn walk_grid_cells(x0: f64, y0: f64, x1: f64, y1: f64, cell_size: f64) -> Vec<CellKey> {
    let mut cell_x = (x0 / cell_size).floor() as i32;
    let mut cell_y = (y0 / cell_size).floor() as i32;
    let end_cell_x = (x1 / cell_size).floor() as i32;
    let end_cell_y = (y1 / cell_size).floor() as i32;

    let mut visited = vec![(cell_x, cell_y)];
    if cell_x == end_cell_x && cell_y == end_cell_y {
        return visited;
    }

    let dx = x1 - x0;
    let dy = y1 - y0;
    let step_x: i32 = if dx > 0.0 { 1 } else if dx < 0.0 { -1 } else { 0 };
    let step_y: i32 = if dy > 0.0 { 1 } else if dy < 0.0 { -1 } else { 0 };

    let next_boundary_x = if step_x > 0 {
        (cell_x + 1) as f64 * cell_size
    } else {
        cell_x as f64 * cell_size
    };
    let next_boundary_y = if step_y > 0 {
        (cell_y + 1) as f64 * cell_size
    } else {
        cell_y as f64 * cell_size
    };

    let mut t_max_x = if step_x != 0 { (next_boundary_x - x0) / dx } else { f64::INFINITY };
    let mut t_max_y = if step_y != 0 { (next_boundary_y - y0) / dy } else { f64::INFINITY };
    let t_delta_x = if step_x != 0 { cell_size / dx.abs() } else { f64::INFINITY };
    let t_delta_y = if step_y != 0 { cell_size / dy.abs() } else { f64::INFINITY };

    let max_steps = (end_cell_x - cell_x).abs() + (end_cell_y - cell_y).abs() + 4;
    for _ in 0..max_steps {
        if t_max_x < t_max_y {
            t_max_x += t_delta_x;
            cell_x += step_x;
        } else if t_max_y < t_max_x {
            t_max_y += t_delta_y;
            cell_y += step_y;
        } else {
            // Exact diagonal — visit both corner-sharing cells.
            visited.push((cell_x + step_x, cell_y));
            visited.push((cell_x, cell_y + step_y));
            t_max_x += t_delta_x;
            t_max_y += t_delta_y;
            cell_x += step_x;
            cell_y += step_y;
        }
        visited.push((cell_x, cell_y));
        if cell_x == end_cell_x && cell_y == end_cell_y {
            break;
        }
    }
    visited
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geo::Point2;

    fn tiny_bldg(cx: f64, cy: f64) -> Building {
        Building {
            footprint: vec![vec![
                [cx - 1.0, cy - 1.0],
                [cx + 1.0, cy - 1.0],
                [cx + 1.0, cy + 1.0],
                [cx - 1.0, cy + 1.0],
                [cx - 1.0, cy - 1.0],
            ]],
            height: 10.0,
        }
    }

    #[test]
    fn single_cell_walk() {
        // Both endpoints in the same 50m cell — result is exactly [start].
        let cells = walk_grid_cells(1.0, 1.0, 2.0, 2.0, 50.0);
        assert_eq!(cells, vec![(0, 0)]);
    }

    #[test]
    fn horizontal_walk_crosses_expected_cells() {
        // From x=25 to x=175 at y=25, cell size 50 → cells (0,0),(1,0),(2,0),(3,0).
        let cells = walk_grid_cells(25.0, 25.0, 175.0, 25.0, 50.0);
        assert_eq!(cells, vec![(0, 0), (1, 0), (2, 0), (3, 0)]);
    }

    #[test]
    fn exact_diagonal_visits_both_corner_cells() {
        // From (25,25) to (125,125). Cell corner at (50,50) is exactly on
        // the line — the walk should visit both (0,1) and (1,0) at that
        // corner, not skip diagonally.
        let cells = walk_grid_cells(25.0, 25.0, 125.0, 125.0, 50.0);
        assert!(cells.contains(&(0, 1)) && cells.contains(&(1, 0)),
                "walked cells: {:?}", cells);
    }

    #[test]
    fn index_query_returns_only_bbox_overlappers() {
        let bldgs = vec![
            tiny_bldg(10.0, 10.0),  // cell (0,0)
            tiny_bldg(200.0, 200.0), // cell (4,4)
        ];
        let idx = BuildingIndex::build(&bldgs);
        // Segment inside cell (0,0) → only the first building
        let hits = idx.query(5.0, 5.0, 15.0, 15.0);
        assert_eq!(hits, vec![0]);
    }

    #[test]
    fn index_query_dedupes_across_shared_buckets() {
        // A large building spanning multiple cells appears in each cell's
        // bucket, but query() must return it only once.
        let big = Building {
            footprint: vec![vec![
                [10.0, 10.0], [200.0, 10.0], [200.0, 200.0], [10.0, 200.0], [10.0, 10.0],
            ]],
            height: 30.0,
        };
        let idx = BuildingIndex::build(&[big]);
        let hits = idx.query(20.0, 20.0, 190.0, 190.0);
        assert_eq!(hits, vec![0]);
    }
}

/* tslint:disable */
/* eslint-disable */

export function angular_size_gate(theta_deg: number): number;

export function apparent_altitude(orthometric_meters: number, distance_meters: number): number;

export function apparent_altitude_k(orthometric_meters: number, distance_meters: number, k: number): number;

export function apparent_angular_diameter_deg(horizontal_distance: number, height_diff: number, shell_radius: number): number;

export function comfort_factor(theta_deg: number, phi_deg: number): number;

/**
 * Per-building rooftop scores. Buildings ride the same three-array
 * packing as computeViewshed; terrain rides the same 7-scalars +
 * has_terrain flag pattern. Output is a flat Float64Array of length
 * `3 * num_buildings`.
 */
export function computeRooftopLayer(launch_lat: number, launch_lng: number, target_height: number, shell_radius: number, heights: Float32Array, vertex_counts: Uint32Array, vertex_data: Float64Array, has_terrain: number, terrain_data: Float32Array, terrain_cells_x: number, terrain_cells_y: number, terrain_north_lat: number, terrain_west_lng: number, terrain_lat_step_deg: number, terrain_lng_step_deg: number): Float64Array;

/**
 * Compute a sightline profile.
 *
 * Buildings ride the same three-array packing as computeViewshed /
 * computeRooftopLayer; terrain rides the same 7-scalars + `has_terrain`
 * flag. `observer_height` is the observer's height above their
 * ground (matches JS's default of EYE_HEIGHT = 1.6 when unset).
 *
 * Return format — one flat Float64Array:
 *
 * ```text
 * [0..14):  header
 *   0  total_distance
 *   1  launch_elev
 *   2  observer_ground_elev
 *   3  observer_abs_alt
 *   4  target_abs_alt
 *   5  target_apparent_alt
 *   6  min_alt              (-Infinity when no blockers)
 *   7  frac
 *   8  theta
 *   9  phi
 *   10 score
 *   11 category              (0=blocked, 1=poor-angle, 2=partial, 3=good)
 *   12 num_hits
 *   13 num_terrain_points
 *
 * [14 .. 14 + 4*num_hits):    hits, each = [bldg_idx, distance, req, abs_height]
 * [ .. + 2*num_terrain_points): terrain samples, each = [distance, elevation]
 * ```
 *
 * Empty Vec on shape error from the marshaling layer.
 */
export function computeSightlineProfile(launch_lat: number, launch_lng: number, observer_lat: number, observer_lng: number, target_height: number, shell_radius: number, observer_height: number, heights: Float32Array, vertex_counts: Uint32Array, vertex_data: Float64Array, has_terrain: number, terrain_data: Float32Array, terrain_cells_x: number, terrain_cells_y: number, terrain_north_lat: number, terrain_west_lng: number, terrain_lat_step_deg: number, terrain_lng_step_deg: number): Float64Array;

/**
 * See module-doc for the output layout. Empty Vec on shape error.
 */
export function computeViewshed(launch_lat: number, launch_lng: number, target_height: number, shell_radius: number, analysis_radius: number, radial_spacing: number, angular_spacing_deg: number, heights: Float32Array, vertex_counts: Uint32Array, vertex_data: Float64Array, has_terrain: number, terrain_data: Float32Array, terrain_cells_x: number, terrain_cells_y: number, terrain_north_lat: number, terrain_west_lng: number, terrain_lat_step_deg: number, terrain_lng_step_deg: number): Float64Array;

export function curvature_drop(distance_meters: number): number;

export function curvature_drop_k(distance_meters: number, k: number): number;

/**
 * Test-only: bilinear elevation lookup returning `f64::NAN` outside
 * coverage (rather than `null`, since we can't return Option across
 * the wasm-bindgen boundary as one f64 easily).
 */
export function elevationBilinear(data: Float32Array, cells_x: number, cells_y: number, north_lat: number, west_lng: number, lat_step_deg: number, lng_step_deg: number, lng: number, lat: number): number;

export function elevation_angle_deg(horizontal_distance: number, height_diff: number): number;

export function elevation_score(phi_deg: number): number;

export function eyeHeight(): number;

export function fraction_visible(min_alt: number, target_height: number, shell_radius: number): number;

export function intersectSegmentBuildingFlat(ox: number, oy: number, oz: number, tx: number, ty: number, tz: number, footprint_xy: Float64Array, height: number): Float64Array;

export function is_blocked(frac: number): boolean;

export function projectLatLngLat(origin_lat: number, origin_lng: number, x: number, y: number): number;

export function projectLatLngLng(origin_lat: number, origin_lng: number, x: number, y: number): number;

export function projectLocalX(origin_lat: number, origin_lng: number, lat: number, lng: number): number;

export function projectLocalY(origin_lat: number, origin_lng: number, lat: number, lng: number): number;

/**
 * Returns [n_buildings, total_verts, sum_heights, min_x, max_x, min_y, max_y].
 * Empty input returns [0, 0, 0, +Inf, -Inf, +Inf, -Inf].
 */
export function roundtripBuildings(heights: Float32Array, vertex_counts: Uint32Array, vertex_data: Float64Array): Float64Array;

/**
 * Returns [cells_x, cells_y, south_lat, east_lng, sum_of_data].
 * `sum_of_data` is the reduction that catches any silent per-pixel
 * corruption (a mismatched Float32Array view would give a totally
 * different sum). NaN row on shape/length failure.
 */
export function roundtripTerrain(data: Float32Array, cells_x: number, cells_y: number, north_lat: number, west_lng: number, lat_step_deg: number, lng_step_deg: number): Float64Array;

/**
 * Composite score. `weather` defaults to 1 on the JS side; wasm-bindgen
 * doesn't support optional args cleanly, so callers always pass it. The
 * only current caller (computeViewshed loops) always has the value in
 * hand, so no ergonomics loss.
 */
export function score(min_alt: number, target_height: number, shell_radius: number, eye_h: number, horizontal_distance: number, weather: number): number;

/**
 * Returns a small integer for the category so the wasm-bindgen boundary
 * stays as a numeric primitive rather than allocating a JS string on
 * every cell. JS side maps: 0=blocked, 1=poor-angle, 2=partial, 3=good.
 */
export function visibility_category(frac: number, comfort: number): number;

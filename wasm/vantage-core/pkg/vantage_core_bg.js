/**
 * @param {number} theta_deg
 * @returns {number}
 */
export function angular_size_gate(theta_deg) {
    const ret = wasm.angular_size_gate(theta_deg);
    return ret;
}

/**
 * @param {number} orthometric_meters
 * @param {number} distance_meters
 * @returns {number}
 */
export function apparent_altitude(orthometric_meters, distance_meters) {
    const ret = wasm.apparent_altitude(orthometric_meters, distance_meters);
    return ret;
}

/**
 * @param {number} orthometric_meters
 * @param {number} distance_meters
 * @param {number} k
 * @returns {number}
 */
export function apparent_altitude_k(orthometric_meters, distance_meters, k) {
    const ret = wasm.apparent_altitude_k(orthometric_meters, distance_meters, k);
    return ret;
}

/**
 * @param {number} horizontal_distance
 * @param {number} height_diff
 * @param {number} shell_radius
 * @returns {number}
 */
export function apparent_angular_diameter_deg(horizontal_distance, height_diff, shell_radius) {
    const ret = wasm.apparent_angular_diameter_deg(horizontal_distance, height_diff, shell_radius);
    return ret;
}

/**
 * @param {number} theta_deg
 * @param {number} phi_deg
 * @returns {number}
 */
export function comfort_factor(theta_deg, phi_deg) {
    const ret = wasm.comfort_factor(theta_deg, phi_deg);
    return ret;
}

/**
 * @param {number} distance_meters
 * @returns {number}
 */
export function curvature_drop(distance_meters) {
    const ret = wasm.curvature_drop(distance_meters);
    return ret;
}

/**
 * @param {number} distance_meters
 * @param {number} k
 * @returns {number}
 */
export function curvature_drop_k(distance_meters, k) {
    const ret = wasm.curvature_drop_k(distance_meters, k);
    return ret;
}

/**
 * Test-only: bilinear elevation lookup returning `f64::NAN` outside
 * coverage (rather than `null`, since we can't return Option across
 * the wasm-bindgen boundary as one f64 easily).
 * @param {Float32Array} data
 * @param {number} cells_x
 * @param {number} cells_y
 * @param {number} north_lat
 * @param {number} west_lng
 * @param {number} lat_step_deg
 * @param {number} lng_step_deg
 * @param {number} lng
 * @param {number} lat
 * @returns {number}
 */
export function elevationBilinear(data, cells_x, cells_y, north_lat, west_lng, lat_step_deg, lng_step_deg, lng, lat) {
    const ptr0 = passArrayF32ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.elevationBilinear(ptr0, len0, cells_x, cells_y, north_lat, west_lng, lat_step_deg, lng_step_deg, lng, lat);
    return ret;
}

/**
 * @param {number} horizontal_distance
 * @param {number} height_diff
 * @returns {number}
 */
export function elevation_angle_deg(horizontal_distance, height_diff) {
    const ret = wasm.elevation_angle_deg(horizontal_distance, height_diff);
    return ret;
}

/**
 * @param {number} phi_deg
 * @returns {number}
 */
export function elevation_score(phi_deg) {
    const ret = wasm.elevation_score(phi_deg);
    return ret;
}

/**
 * @returns {number}
 */
export function eyeHeight() {
    const ret = wasm.eyeHeight();
    return ret;
}

/**
 * @param {number} min_alt
 * @param {number} target_height
 * @param {number} shell_radius
 * @returns {number}
 */
export function fraction_visible(min_alt, target_height, shell_radius) {
    const ret = wasm.fraction_visible(min_alt, target_height, shell_radius);
    return ret;
}

/**
 * @param {number} ox
 * @param {number} oy
 * @param {number} oz
 * @param {number} tx
 * @param {number} ty
 * @param {number} tz
 * @param {Float64Array} footprint_xy
 * @param {number} height
 * @returns {Float64Array}
 */
export function intersectSegmentBuildingFlat(ox, oy, oz, tx, ty, tz, footprint_xy, height) {
    const ptr0 = passArrayF64ToWasm0(footprint_xy, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.intersectSegmentBuildingFlat(ox, oy, oz, tx, ty, tz, ptr0, len0, height);
    var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v2;
}

/**
 * @param {number} frac
 * @returns {boolean}
 */
export function is_blocked(frac) {
    const ret = wasm.is_blocked(frac);
    return ret !== 0;
}

/**
 * @param {number} origin_lat
 * @param {number} origin_lng
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function projectLatLngLat(origin_lat, origin_lng, x, y) {
    const ret = wasm.projectLatLngLat(origin_lat, origin_lng, x, y);
    return ret;
}

/**
 * @param {number} origin_lat
 * @param {number} origin_lng
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function projectLatLngLng(origin_lat, origin_lng, x, y) {
    const ret = wasm.projectLatLngLng(origin_lat, origin_lng, x, y);
    return ret;
}

/**
 * @param {number} origin_lat
 * @param {number} origin_lng
 * @param {number} lat
 * @param {number} lng
 * @returns {number}
 */
export function projectLocalX(origin_lat, origin_lng, lat, lng) {
    const ret = wasm.projectLocalX(origin_lat, origin_lng, lat, lng);
    return ret;
}

/**
 * @param {number} origin_lat
 * @param {number} origin_lng
 * @param {number} lat
 * @param {number} lng
 * @returns {number}
 */
export function projectLocalY(origin_lat, origin_lng, lat, lng) {
    const ret = wasm.projectLocalY(origin_lat, origin_lng, lat, lng);
    return ret;
}

/**
 * Composite score. `weather` defaults to 1 on the JS side; wasm-bindgen
 * doesn't support optional args cleanly, so callers always pass it. The
 * only current caller (computeViewshed loops) always has the value in
 * hand, so no ergonomics loss.
 * @param {number} min_alt
 * @param {number} target_height
 * @param {number} shell_radius
 * @param {number} eye_h
 * @param {number} horizontal_distance
 * @param {number} weather
 * @returns {number}
 */
export function score(min_alt, target_height, shell_radius, eye_h, horizontal_distance, weather) {
    const ret = wasm.score(min_alt, target_height, shell_radius, eye_h, horizontal_distance, weather);
    return ret;
}

/**
 * Returns a small integer for the category so the wasm-bindgen boundary
 * stays as a numeric primitive rather than allocating a JS string on
 * every cell. JS side maps: 0=blocked, 1=poor-angle, 2=partial, 3=good.
 * @param {number} frac
 * @param {number} comfort
 * @returns {number}
 */
export function visibility_category(frac, comfort) {
    const ret = wasm.visibility_category(frac, comfort);
    return ret >>> 0;
}
export function __wbindgen_init_externref_table() {
    const table = wasm.__wbindgen_externrefs;
    const offset = table.grow(4);
    table.set(0, undefined);
    table.set(offset + 0, undefined);
    table.set(offset + 1, null);
    table.set(offset + 2, true);
    table.set(offset + 3, false);
}
function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let WASM_VECTOR_LEN = 0;


let wasm;
export function __wbg_set_wasm(val) {
    wasm = val;
}

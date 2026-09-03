/**
 * Geometrically exact fraction of a shell's disk that sits above the
 * nearest obstruction. See 烟花可视性数学模型.md §3.2 for the derivation
 * and `lib/viewshed/scoring.js` for the JavaScript reference
 * implementation this mirrors.
 *
 * `k = (min_alt - target_height) / shell_radius` is the horizontal cut
 * line in units of R from the disk center. `f(k) = [acos(k) − k·√(1−k²)] / π`.
 * @param {number} min_alt
 * @param {number} target_height
 * @param {number} shell_radius
 * @returns {number}
 */
export function fraction_visible(min_alt, target_height, shell_radius) {
    const ret = wasm.fraction_visible(min_alt, target_height, shell_radius);
    return ret;
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

let wasm;
export function __wbg_set_wasm(val) {
    wasm = val;
}

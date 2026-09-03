/* tslint:disable */
/* eslint-disable */

/**
 * Geometrically exact fraction of a shell's disk that sits above the
 * nearest obstruction. See 烟花可视性数学模型.md §3.2 for the derivation
 * and `lib/viewshed/scoring.js` for the JavaScript reference
 * implementation this mirrors.
 *
 * `k = (min_alt - target_height) / shell_radius` is the horizontal cut
 * line in units of R from the disk center. `f(k) = [acos(k) − k·√(1−k²)] / π`.
 */
export function fraction_visible(min_alt: number, target_height: number, shell_radius: number): number;

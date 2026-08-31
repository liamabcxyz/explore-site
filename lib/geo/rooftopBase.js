/**
 * If a launch point sits on a building's footprint (a rooftop/terrace show,
 * common for organized displays), the real burst height is the caliber-
 * derived height *above that roof*, not above z=0 ground — otherwise the
 * whole building's height is silently dropped, systematically understating
 * how high the shells actually reach. See todo.md P1-3.
 *
 * Not a terrain/DEM correction (that's the ground itself being uneven
 * everywhere, tracked separately) — this only asks "is this one point inside
 * a building," using data already being queried for occlusion.
 */

// Standard ray-casting / even-odd point-in-polygon test. Only the exterior
// ring is checked — same as the occlusion math elsewhere in lib/viewshed/,
// a courtyard hole doesn't change whether you're standing on the building.
function pointInRing([px, py], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * Same "is this point on a building" question as findRooftopBase, but also
 * used for the observer's end of a sightline (lib/viewshed/computeProfile.js)
 * where the height-confidence matters too — a floor picker built on a "low
 * confidence, guessed from building class" height should say so.
 *
 * @param {{lat:number, lng:number}} point
 * @param {Array<{footprint: Array<Array<[number,number]>>, height: number, confidence: string}>} buildings
 *   normalizeBuilding() output — footprint rings are [lng, lat] pairs, same
 *   space as `point`, so no projection is needed for a containment test.
 * @returns {{height:number, confidence:string} | null} the tallest building
 *   whose footprint contains the point, or null if it's not on any building.
 */
export function findBuildingAt(point, buildings) {
  const p = [point.lng, point.lat];
  let tallest = null;
  for (const building of buildings) {
    if ((!tallest || building.height > tallest.height) && pointInRing(p, building.footprint[0])) {
      tallest = building;
    }
  }
  return tallest ? { height: tallest.height, confidence: tallest.confidence } : null;
}

/**
 * @param {{lat:number, lng:number}} point
 * @param {Array<{footprint: Array<Array<[number,number]>>, height: number}>} buildings
 * @returns {number} the tallest building's height whose footprint contains
 *   the point, or 0 if it's not on any building.
 */
export function findRooftopBase(point, buildings) {
  return findBuildingAt(point, buildings)?.height ?? 0;
}

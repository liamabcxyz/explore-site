/**
 * Equirectangular WGS84 -> local flat-meters projection, centered on an
 * origin point. Accurate at city-block scale (the error this introduces is
 * far smaller than the height-data uncertainty the viewshed math already
 * carries); not meant for anything beyond neighborhood-scale distances.
 *
 * @param {number} originLat
 * @param {number} originLng
 */
const METERS_PER_DEGREE_LAT = 111320;

export function makeLocalProjector(originLat, originLng) {
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos((originLat * Math.PI) / 180);

  return {
    toLocal(lat, lng) {
      return {
        x: (lng - originLng) * metersPerDegreeLng,
        y: (lat - originLat) * METERS_PER_DEGREE_LAT,
      };
    },
    toLatLng(x, y) {
      return {
        lat: originLat + y / METERS_PER_DEGREE_LAT,
        lng: originLng + x / metersPerDegreeLng,
      };
    },
  };
}

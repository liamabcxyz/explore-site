import { latLngToTileXY, tileXYToLatLng } from "@/lib/viewshed/ElevationGrid";
import { makeLocalProjector } from "@/lib/geo/toLocalMeters";

/**
 * Unique Web-Mercator tiles a buffered corridor from `from` to `to` covers
 * at `zoom`. Samples the centerline and ±buffer/2 offsets so a 200m pad
 * around a 20km line picks up edge-straddling tiles without taking the
 * line's axis-aligned bbox (a NE–SW 20km line's bbox is ~20×20km).
 *
 * @returns {Array<{z:number,x:number,y:number}>}
 */
export function tilesAlongCorridor(from, to, zoom, bufferMeters) {
  const projector = makeLocalProjector(from.lat, from.lng);
  const end = projector.toLocal(to.lat, to.lng);
  const length = Math.hypot(end.x, end.y);
  const keys = new Set();

  const addLatLng = (lat, lng) => {
    const { x, y } = latLngToTileXY(lat, lng, zoom);
    keys.add(`${Math.floor(x)}/${Math.floor(y)}`);
  };

  addLatLng(from.lat, from.lng);
  addLatLng(to.lat, to.lng);

  if (length < 1) {
    return [...keys].map((key) => {
      const [x, y] = key.split("/").map(Number);
      return { z: zoom, x, y };
    });
  }

  const dirX = end.x / length;
  const dirY = end.y / length;
  const perpX = -dirY;
  const perpY = dirX;
  const half = Math.max(0, bufferMeters) / 2;
  // ~1/8 of a z14 tile at mid-latitudes, dense enough to not skip a tile.
  const step = 200;

  for (let d = 0; d <= length; d += step) {
    for (const offset of [-half, 0, half]) {
      const { lat, lng } = projector.toLatLng(
        d * dirX + offset * perpX,
        d * dirY + offset * perpY,
      );
      addLatLng(lat, lng);
    }
  }
  // Force the true endpoint in case `step` jumped over it.
  for (const offset of [-half, 0, half]) {
    const { lat, lng } = projector.toLatLng(
      end.x + offset * perpX,
      end.y + offset * perpY,
    );
    addLatLng(lat, lng);
  }

  return [...keys].map((key) => {
    const [x, y] = key.split("/").map(Number);
    return { z: zoom, x, y };
  });
}

/**
 * Distance span [d0, d1] along from→to (meters from `from`) that overlaps
 * a given tile's geographic bbox, or null if the segment misses the tile.
 * Used to mark coverage gaps on the profile instead of treating a missing
 * tile as "no buildings / flat ground."
 */
export function tileDistanceSpan(tile, from, to, zoom) {
  const nw = tileXYToLatLng(tile.x, tile.y, zoom);
  const se = tileXYToLatLng(tile.x + 1, tile.y + 1, zoom);
  const west = Math.min(nw.lng, se.lng);
  const east = Math.max(nw.lng, se.lng);
  const south = Math.min(nw.lat, se.lat);
  const north = Math.max(nw.lat, se.lat);

  const projector = makeLocalProjector(from.lat, from.lng);
  const end = projector.toLocal(to.lat, to.lng);
  const length = Math.hypot(end.x, end.y);
  if (length < 1) {
    const inside =
      from.lng >= west && from.lng <= east && from.lat >= south && from.lat <= north;
    return inside ? { fromMeters: 0, toMeters: 0 } : null;
  }

  // Sample the segment; tile edges are ~2km so 50m is plenty to catch overlap.
  const step = 50;
  let d0 = null;
  let d1 = null;
  for (let d = 0; d <= length; d += step) {
    const t = d / length;
    const { lat, lng } = projector.toLatLng(end.x * t, end.y * t);
    if (lng >= west && lng <= east && lat >= south && lat <= north) {
      if (d0 === null) d0 = d;
      d1 = d;
    }
  }
  const { lat, lng } = to;
  if (lng >= west && lng <= east && lat >= south && lat <= north) {
    if (d0 === null) d0 = length;
    d1 = length;
  }
  if (d0 === null) return null;
  return { fromMeters: d0, toMeters: d1 };
}

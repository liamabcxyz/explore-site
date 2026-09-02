/**
 * Elevation raster for a small geographic area (typically a 1.5km-radius
 * analysis bbox around a launch point), backed by AWS Terrain Tiles.
 * See 地形高程集成_实施方案.md for the full context.
 *
 * Split into two concerns:
 *   1. ElevationGrid class — pure data wrapper with getElevation(lng,lat).
 *      Zero I/O; takes decoded pixels in the constructor.
 *      Trivially unit-testable and reusable in Node (Jest).
 *   2. loadElevationGridForBounds() — browser-only async loader that
 *      computes the covering tile set, fetches PNGs, Terrarium-decodes,
 *      stitches into a single grid, and returns an ElevationGrid.
 *      Uses fetch + createImageBitmap + OffscreenCanvas — not runnable
 *      under Jest's jsdom environment; integration-tested by Phase 3's
 *      real usage rather than mocked here.
 */

import { traceFetch } from "@/lib/debug/trace";

// AWS Terrain Tiles, Terrarium encoding — same source registered as the
// display layer in Phase 1 (lib/LayerManager.js). Zoom 14 gives ~9.5m per
// pixel at 40°N, matching the 10m target the plan doc uses. A 3km-diameter
// bbox at z=14 needs at most ~4 tiles worst case.
const TERRAIN_TILE_URL =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const TERRAIN_TILE_ZOOM = 14;
const TILE_SIZE = 256;

/**
 * Web Mercator slippy-map tile coordinates (fractional). x grows east,
 * y grows south. Exported for the tile-math unit test — the loader uses
 * this internally.
 */
export function latLngToTileXY(lat, lng, zoom) {
  const n = 2 ** zoom;
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

/**
 * Inverse of latLngToTileXY — used to convert stitched-grid pixel indices
 * back to lat/lng, so getElevation can locate a query point in the grid.
 */
export function tileXYToLatLng(x, y, zoom) {
  const n = 2 ** zoom;
  const lng = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return { lat: (latRad * 180) / Math.PI, lng };
}

export class ElevationGrid {
  /**
   * @param {object} args
   * @param {Float32Array} args.data - row-major, length cellsX*cellsY;
   *   index 0 is the top-left pixel (northwest corner)
   * @param {number} args.cellsX - width in pixels
   * @param {number} args.cellsY - height in pixels
   * @param {number} args.northLat - latitude of the top-left pixel center
   * @param {number} args.westLng - longitude of the top-left pixel center
   * @param {number} args.latStepDeg - degrees per pixel row (negative — lat
   *   decreases as row index grows)
   * @param {number} args.lngStepDeg - degrees per pixel column (positive)
   */
  constructor({ data, cellsX, cellsY, northLat, westLng, latStepDeg, lngStepDeg }) {
    if (data.length !== cellsX * cellsY) {
      throw new Error(`ElevationGrid data length ${data.length} != cellsX*cellsY (${cellsX * cellsY})`);
    }
    this.data = data;
    this.cellsX = cellsX;
    this.cellsY = cellsY;
    this.northLat = northLat;
    this.westLng = westLng;
    this.latStepDeg = latStepDeg;
    this.lngStepDeg = lngStepDeg;
    // Precompute the SE corner for hasCoverage — cheap and read a lot.
    this._southLat = northLat + latStepDeg * (cellsY - 1);
    this._eastLng = westLng + lngStepDeg * (cellsX - 1);
  }

  /**
   * True if (lng, lat) sits inside the covered rectangle. Points on the
   * boundary count as covered.
   */
  hasCoverage(lng, lat) {
    // latStep is negative — north > south — so hasCoverage checks
    // lat between south and north with the sign in mind.
    return (
      lng >= this.westLng &&
      lng <= this._eastLng &&
      lat >= this._southLat &&
      lat <= this.northLat
    );
  }

  /**
   * Bilinear interpolation of the 4 pixels surrounding (lng, lat).
   * Returns meters (Terrarium-decoded elevation) or null if the point is
   * outside coverage. Bilinear (not nearest-neighbor) is required —
   * step-shape artifacts at 10m pixel edges would visibly pollute the
   * smooth viewshed color gradients downstream.
   */
  getElevation(lng, lat) {
    if (!this.hasCoverage(lng, lat)) return null;
    // Fractional column/row: col=0 at westLng, col=cellsX-1 at eastLng
    const col = (lng - this.westLng) / this.lngStepDeg;
    const row = (lat - this.northLat) / this.latStepDeg; // both negative → positive
    // Anchor is the top-left of the 4 surrounding pixels. Clamp so we don't
    // walk off the right/bottom edge when the query lands exactly on the
    // last pixel — with the clamp, the fractional weight goes to 0 and the
    // interpolation degenerates to just returning that last pixel's value,
    // which is what we want.
    const c0 = Math.min(Math.floor(col), this.cellsX - 2);
    const r0 = Math.min(Math.floor(row), this.cellsY - 2);
    const fx = col - c0;
    const fy = row - r0;
    const w = this.cellsX;
    const v00 = this.data[r0 * w + c0];
    const v10 = this.data[r0 * w + (c0 + 1)];
    const v01 = this.data[(r0 + 1) * w + c0];
    const v11 = this.data[(r0 + 1) * w + (c0 + 1)];
    // Standard bilinear formula.
    return (
      v00 * (1 - fx) * (1 - fy) +
      v10 * fx * (1 - fy) +
      v01 * (1 - fx) * fy +
      v11 * fx * fy
    );
  }

  /**
   * All-zeros grid covering an arbitrary bbox — used by Phase 3's test
   * migration (see plan doc §6): existing viewshed tests can pass this in
   * as `terrainGrid` and get byte-identical numerical results to the pre-
   * terrain fixtures, because 0m everywhere collapses "absolute altitude"
   * to "relative altitude" and every height baseline stays where it was.
   */
  static flat({ westLng, northLat, eastLng, southLat, cellsX = 2, cellsY = 2 }) {
    const data = new Float32Array(cellsX * cellsY); // all zeros
    const lngStepDeg = (eastLng - westLng) / (cellsX - 1);
    const latStepDeg = (southLat - northLat) / (cellsY - 1); // negative
    return new ElevationGrid({ data, cellsX, cellsY, northLat, westLng, latStepDeg, lngStepDeg });
  }
}

// Terrarium decoding: R, G, B → meters above sea level.
// See https://github.com/tilezen/joerd/blob/master/docs/formats.md
function decodeTerrarium(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

/**
 * Fetch the AWS Terrain tiles covering [westLng, southLat, eastLng, northLat]
 * at TERRAIN_TILE_ZOOM, decode each PNG's RGB into meters (Terrarium
 * encoding), stitch into a single Float32Array, and return an
 * ElevationGrid.
 *
 * Browser-only — depends on fetch, createImageBitmap, and OffscreenCanvas.
 * Not testable under Jest jsdom; integration-tested by Phase 3's real
 * usage in the viewshed worker.
 *
 * @returns {Promise<ElevationGrid>}
 */
async function fetchTerrariumTile(z, x, y) {
  const url = TERRAIN_TILE_URL
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
  // Wrapped so the "Report a problem" debug bundle can see this fetch's
  // status/timing. Handles both success and failure paths — a 404 is
  // still visible in the trace instead of just landing in console.warn.
  const response = await traceFetch("terrarium", url, () => fetch(url));
  if (!response.ok) throw new Error(`terrain tile ${z}/${x}/${y}: HTTP ${response.status}`);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  const { data: rgba } = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
  const tile = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let py = 0; py < TILE_SIZE; py++) {
    for (let px = 0; px < TILE_SIZE; px++) {
      const rgbaOffset = (py * TILE_SIZE + px) * 4;
      tile[py * TILE_SIZE + px] = decodeTerrarium(rgba[rgbaOffset], rgba[rgbaOffset + 1], rgba[rgbaOffset + 2]);
    }
  }
  return tile;
}

/**
 * Corridor loader — fetches only the z14 tiles a buffered observer→launch
 * line actually crosses, returned as a TileElevationGrid (sparse, so a
 * diagonal 20km line doesn't allocate a 20×20km rectangle). Missing tiles
 * are omitted from the map; getElevation returns null there and the caller
 * records a coverage gap.
 *
 * @returns {Promise<{grid: import("./TileElevationGrid").TileElevationGrid, missingTiles: Array<{z:number,x:number,y:number}>}>}
 */
export async function loadElevationGridForCorridor({ from, to, bufferMeters = 200, zoom = TERRAIN_TILE_ZOOM }) {
  const { tilesAlongCorridor } = await import("@/lib/viewshed/tileWalk");
  const { TileElevationGrid } = await import("@/lib/viewshed/TileElevationGrid");
  const tiles = tilesAlongCorridor(from, to, zoom, bufferMeters);
  const decoded = new Map();
  const missingTiles = [];
  await Promise.all(
    tiles.map(async (tile) => {
      try {
        const data = await fetchTerrariumTile(tile.z, tile.x, tile.y);
        decoded.set(TileElevationGrid.tileKey(tile.x, tile.y), data);
      } catch {
        missingTiles.push(tile);
      }
    }),
  );
  return { grid: new TileElevationGrid({ zoom, tiles: decoded }), missingTiles };
}

export async function loadElevationGridForBounds({
  westLng,
  southLat,
  eastLng,
  northLat,
  zoom = TERRAIN_TILE_ZOOM,
}) {
  const nwTile = latLngToTileXY(northLat, westLng, zoom);
  const seTile = latLngToTileXY(southLat, eastLng, zoom);
  const tileX0 = Math.floor(nwTile.x);
  const tileY0 = Math.floor(nwTile.y);
  const tileX1 = Math.floor(seTile.x);
  const tileY1 = Math.floor(seTile.y);
  const tileCountX = tileX1 - tileX0 + 1;
  const tileCountY = tileY1 - tileY0 + 1;

  // Stitched dimensions in pixels. The final grid's top-left pixel is
  // pixel (0,0) of tile (tileX0, tileY0), which corresponds to the NW
  // corner of that tile in lat/lng.
  const cellsX = tileCountX * TILE_SIZE;
  const cellsY = tileCountY * TILE_SIZE;
  const data = new Float32Array(cellsX * cellsY);

  await Promise.all(
    Array.from({ length: tileCountY }, (_, ty) =>
      Array.from({ length: tileCountX }, async (__, tx) => {
        const tile = await fetchTerrariumTile(zoom, tileX0 + tx, tileY0 + ty);
        const rowStart = ty * TILE_SIZE;
        const colStart = tx * TILE_SIZE;
        for (let py = 0; py < TILE_SIZE; py++) {
          for (let px = 0; px < TILE_SIZE; px++) {
            data[(rowStart + py) * cellsX + (colStart + px)] = tile[py * TILE_SIZE + px];
          }
        }
      })
    ).flat()
  );

  // Convert stitched-grid pixel (0,0) and pixel (cellsX-1, cellsY-1) to
  // lat/lng via the tile coordinate inverse. The pixel center is at
  // tileCoord + 0.5/TILE_SIZE within its tile; we want the top-left
  // corner's lat/lng (pixel 0,0 of tile tileX0,tileY0).
  const nw = tileXYToLatLng(tileX0, tileY0, zoom);
  const se = tileXYToLatLng(tileX0 + tileCountX, tileY0 + tileCountY, zoom);
  // northLat/westLng represent the top-left pixel CENTER, not the tile
  // corner — shift by half a pixel in each axis so getElevation's math
  // (which assumes pixel-center anchoring) lands at the right place.
  const lngStepDeg = (se.lng - nw.lng) / cellsX;
  const latStepDeg = (se.lat - nw.lat) / cellsY; // negative — south < north
  const gridNorthLat = nw.lat + latStepDeg / 2;
  const gridWestLng = nw.lng + lngStepDeg / 2;

  return new ElevationGrid({
    data,
    cellsX,
    cellsY,
    northLat: gridNorthLat,
    westLng: gridWestLng,
    latStepDeg,
    lngStepDeg,
  });
}

import { latLngToTileXY } from "@/lib/viewshed/ElevationGrid";

const TILE_SIZE = 256;

/**
 * Sparse DEM: only the Web-Mercator tiles actually fetched for a corridor,
 * not the axis-aligned bbox of that corridor. Same getElevation/hasCoverage
 * surface as ElevationGrid so computeSightlineProfile doesn't care which
 * one it was handed.
 *
 * Pixels outside any loaded tile return null (caller treats that as a
 * coverage gap, not 0m). Bilinear at a tile edge reads the neighboring
 * tile when present; if a neighbor is missing the sample is null rather
 * than half-interpolated against empty.
 */
export class TileElevationGrid {
  /**
   * @param {object} args
   * @param {number} args.zoom
   * @param {Map<string, Float32Array>} args.tiles - key "x/y", 256×256 row-major
   */
  constructor({ zoom, tiles }) {
    this.zoom = zoom;
    this.tiles = tiles;
  }

  static tileKey(x, y) {
    return `${x}/${y}`;
  }

  hasCoverage(lng, lat) {
    const { x, y } = latLngToTileXY(lat, lng, this.zoom);
    return this.tiles.has(TileElevationGrid.tileKey(Math.floor(x), Math.floor(y)));
  }

  /**
   * Sample one pixel (no interpolation) at fractional tile coordinates.
   * Pixel (0,0) of tile (tx, ty) is that tile's NW corner.
   */
  _pixel(tileX, tileY, pixelX, pixelY) {
    const tile = this.tiles.get(TileElevationGrid.tileKey(tileX, tileY));
    if (!tile) return null;
    return tile[pixelY * TILE_SIZE + pixelX];
  }

  getElevation(lng, lat) {
    const { x, y } = latLngToTileXY(lat, lng, this.zoom);
    // Global pixel in the zoom-level mosaic, origin at tile (0,0) NW.
    const globalX = x * TILE_SIZE - 0.5;
    const globalY = y * TILE_SIZE - 0.5;
    const x0 = Math.floor(globalX);
    const y0 = Math.floor(globalY);
    const fx = globalX - x0;
    const fy = globalY - y0;

    const sample = (gx, gy) => {
      const tx = Math.floor(gx / TILE_SIZE);
      const ty = Math.floor(gy / TILE_SIZE);
      let px = gx - tx * TILE_SIZE;
      let py = gy - ty * TILE_SIZE;
      // gx = -1 can happen at the west pole of a tile; wrap into the west neighbor.
      if (px < 0) px += TILE_SIZE;
      if (py < 0) py += TILE_SIZE;
      if (px >= TILE_SIZE) px = TILE_SIZE - 1;
      if (py >= TILE_SIZE) py = TILE_SIZE - 1;
      return this._pixel(tx, ty, px, py);
    };

    const v00 = sample(x0, y0);
    const v10 = sample(x0 + 1, y0);
    const v01 = sample(x0, y0 + 1);
    const v11 = sample(x0 + 1, y0 + 1);
    if (v00 === null || v10 === null || v01 === null || v11 === null) return null;
    return (
      v00 * (1 - fx) * (1 - fy) +
      v10 * fx * (1 - fy) +
      v01 * (1 - fx) * fy +
      v11 * fx * fy
    );
  }
}

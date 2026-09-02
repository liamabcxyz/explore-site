import { tilesAlongCorridor, tileDistanceSpan } from "@/lib/viewshed/tileWalk";
import { buildingsFromMapFeatures } from "@/lib/geo/overtureBuildingAdapter";
import { filterBuildingsNearSegment } from "@/lib/geo/buildingsNearPoint";
import { traceFetch } from "@/lib/debug/trace";

// Overture buildings maxzoom / extrusion minzoom — lower zooms either omit
// footprints or simplify them past usefulness for a sightline.
export const BUILDING_TILE_ZOOM = 14;
export const CORRIDOR_BUFFER_METERS = 200;

const archiveCache = new Map();
const tileCache = new Map();
const TILE_CACHE_MAX = 256;

function stripPmtilesProtocol(url) {
  return typeof url === "string" ? url.replace(/^pmtiles:\/\//, "") : url;
}

function cacheGet(url, z, x, y) {
  return tileCache.get(`${stripPmtilesProtocol(url)}/${z}/${x}/${y}`);
}

function cacheSet(url, z, x, y, value) {
  const key = `${stripPmtilesProtocol(url)}/${z}/${x}/${y}`;
  if (tileCache.size >= TILE_CACHE_MAX) {
    const first = tileCache.keys().next().value;
    tileCache.delete(first);
  }
  tileCache.set(key, value);
}

function layerFeatures(tile, layerName, z, x, y) {
  const layer = tile.layers[layerName];
  if (!layer) return [];
  const out = [];
  for (let i = 0; i < layer.length; i++) {
    const feat = layer.feature(i);
    if (feat.type !== 3) continue; // Polygon
    const geojson = feat.toGeoJSON(x, y, z);
    out.push({
      properties: { id: feat.id, ...feat.properties },
      geometry: geojson.geometry,
    });
  }
  return out;
}

async function loadTile(archive, url, z, x, y, VectorTile, Pbf) {
  const cached = cacheGet(url, z, x, y);
  if (cached !== undefined) return cached;
  // Trace the PMTiles range fetch as a synthetic URL "url#z/x/y" so the
  // debug bundle can distinguish per-tile requests within the same
  // archive without inventing a second dimension in the trace record.
  const traceUrl = `${url}#${z}/${x}/${y}`;
  try {
    let result;
    await traceFetch("corridor-buildings", traceUrl, async () => {
      result = await archive.getZxy(z, x, y);
      // Surface a synthetic Response-shape so traceFetch can record
      // status + byte size uniformly — this call doesn't return a real
      // Response.
      const bytes = result?.data instanceof ArrayBuffer ? result.data.byteLength : result?.data?.length ?? 0;
      return {
        ok: Boolean(result?.data),
        status: result?.data ? 200 : 404,
        headers: { get: (name) => (name.toLowerCase() === "content-length" ? String(bytes) : null) },
      };
    });
    if (!result?.data) {
      cacheSet(url, z, x, y, null);
      return null;
    }
    const bytes = result.data instanceof ArrayBuffer ? new Uint8Array(result.data) : result.data;
    const tile = new VectorTile(new Pbf(bytes));
    const decoded = {
      buildingFeats: layerFeatures(tile, "building", z, x, y),
      partFeats: layerFeatures(tile, "building_part", z, x, y),
    };
    cacheSet(url, z, x, y, decoded);
    return decoded;
  } catch {
    cacheSet(url, z, x, y, null);
    return null;
  }
}

/**
 * Fetch Overture building footprints for a buffered corridor between two
 * points, at z14, via PMTiles getZxy (not a MapLibre camera fitBounds —
 * that would zoom out and miss building tiles).
 *
 * Decoder packages are imported here rather than at module top-level so Jest
 * can load this file without transforming those ESM node_modules.
 *
 * @returns {Promise<{
 *   buildings: ReturnType<typeof buildingsFromMapFeatures>,
 *   coverageGaps: Array<{fromMeters:number, toMeters:number, source:string}>,
 * }>}
 */
export async function loadBuildingsAlongCorridor({ pmtilesUrl, from, to, bufferMeters = CORRIDOR_BUFFER_METERS }) {
  const [{ PMTiles }, vectorTileMod, pbfMod] = await Promise.all([
    import("pmtiles"),
    import("@mapbox/vector-tile"),
    import("pbf"),
  ]);
  const VectorTile = vectorTileMod.VectorTile;
  const Pbf = pbfMod.PbfReader;

  const key = stripPmtilesProtocol(pmtilesUrl);
  let archive = archiveCache.get(key);
  if (!archive) {
    archive = new PMTiles(key);
    archiveCache.set(key, archive);
  }

  const tiles = tilesAlongCorridor(from, to, BUILDING_TILE_ZOOM, bufferMeters);
  const buildingFeats = [];
  const partFeats = [];
  const missing = [];

  await Promise.all(
    tiles.map(async (tile) => {
      const decoded = await loadTile(archive, pmtilesUrl, tile.z, tile.x, tile.y, VectorTile, Pbf);
      if (!decoded) {
        missing.push(tile);
        return;
      }
      buildingFeats.push(...decoded.buildingFeats);
      partFeats.push(...decoded.partFeats);
    }),
  );

  const all = buildingsFromMapFeatures(buildingFeats, partFeats);
  const buildings = filterBuildingsNearSegment(all, from, to, bufferMeters);

  const coverageGaps = [];
  for (const tile of missing) {
    const span = tileDistanceSpan(tile, from, to, BUILDING_TILE_ZOOM);
    if (span) coverageGaps.push({ ...span, source: "buildings" });
  }

  return { buildings, coverageGaps };
}

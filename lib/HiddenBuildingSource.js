import * as maplibregl from "maplibre-gl";
import { makeLocalProjector } from "@/lib/geo/toLocalMeters";

// Extra room beyond the requested radius so a building straddling the edge
// of the analysis circle still gets its whole footprint loaded, not just
// the part nearest the launch point. Independent of buildingsNearPoint.js's
// own MARGIN_METERS (that one pads the *filter*, this one pads the *tile
// fetch* the filter reads from) — keeping them separate constants avoids
// coupling a query-layer concern to a math-layer one.
const BBOX_MARGIN_METERS = 200;
// Bounds this query's worst case if the hidden map never settles (e.g. the
// PMTiles request stalls) — better to hand back whatever's loaded so far
// than hang the caller forever.
const IDLE_TIMEOUT_MS = 8000;

/**
 * map.querySourceFeatures() only answers from vector tiles the *visible*
 * map has already loaded for whatever the user currently has on screen —
 * bounded by the live viewport/zoom, not by whatever radius the caller
 * actually cares about. For LaunchPointControl's viewshed (a fixed radius
 * around the launch point, unrelated to what's currently on screen) that
 * silently drops buildings outside the loaded viewport, showing up as the
 * rooftop-view overlay getting clipped to the loaded-tile/viewport
 * boundary instead of the full analysis circle.
 *
 * This creates a second, hidden maplibre map backed by the same "buildings"
 * vector source, whose camera we point at exactly the requested bbox
 * regardless of what the visible map is showing, then read
 * querySourceFeatures off of it. One instance is meant to be reused across
 * requests (see LaunchPointControl.jsx) rather than recreated per query —
 * each call still costs a real tile fetch + fitBounds settle, so reusing
 * the map instance at least avoids repeating maplibre's own init/style-load
 * overhead on top of that.
 *
 * @param {string} sourceUrl - the same pmtiles:// url the visible map's
 *   "buildings" source uses (read from its style so this never drifts out
 *   of sync with whatever catalog/city is currently loaded).
 */
export function createHiddenBuildingSource(sourceUrl) {
  const container = document.createElement("div");
  container.style.cssText =
    "position:fixed; top:-9999px; left:-9999px; width:1024px; height:1024px; pointer-events:none;";
  document.body.appendChild(container);

  const map = new maplibregl.Map({
    container,
    style: {
      version: 8,
      sources: { buildings: { type: "vector", url: sourceUrl, promoteId: "id" } },
      // MapLibre only fetches a vector source's tiles to satisfy a layer
      // that's actually rendering from it — a source with no layers never
      // triggers a single tile request, no matter how the camera moves.
      // These two exist purely to make that happen; opacity 0 since nothing
      // here is ever meant to be seen (the container itself is off-screen).
      layers: [
        { id: "buildings-probe", type: "fill", source: "buildings", "source-layer": "building", paint: { "fill-opacity": 0 } },
        { id: "building-parts-probe", type: "fill", source: "buildings", "source-layer": "building_part", paint: { "fill-opacity": 0 } },
      ],
    },
    interactive: false,
    attributionControl: false,
    center: [0, 0],
    zoom: 0,
  });
  const ready = new Promise((resolve) => map.once("load", resolve));

  async function query(point, radiusMeters) {
    await ready;
    const projector = makeLocalProjector(point.lat, point.lng);
    const margin = radiusMeters + BBOX_MARGIN_METERS;
    const ne = projector.toLatLng(margin, margin);
    const sw = projector.toLatLng(-margin, -margin);

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      map.once("idle", finish);
      map.fitBounds([[sw.lng, sw.lat], [ne.lng, ne.lat]], { animate: false, padding: 0 });
      setTimeout(finish, IDLE_TIMEOUT_MS);
    });

    return {
      buildingFeats: map.querySourceFeatures("buildings", { sourceLayer: "building" }),
      partFeats: map.querySourceFeatures("buildings", { sourceLayer: "building_part" }),
    };
  }

  function destroy() {
    map.remove();
    container.remove();
  }

  return { query, destroy };
}

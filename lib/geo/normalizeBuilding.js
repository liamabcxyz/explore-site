/**
 * Height fallback chain for Overture Buildings-theme features
 * (docs.overturemaps.org/schema/reference/buildings/building/, verified
 * against this repo's own lib/map-styles/tiles.json, release 2026-02-18.0).
 *
 * `@height_source` names the underlying dataset a height came from (observed
 * live: "OpenStreetMap"), not a ready-made confidence tier — HEIGHT_SOURCE_CONFIDENCE
 * is our own source -> confidence mapping, and only ever downgrades the
 * "height field present" tier, never upgrades a guess into "high".
 */

// Exported — components/launch/LaunchPointControl.jsx reuses this same
// figure to turn "which floor are you on" back into meters for the observer
// height picker, rather than re-guessing a different constant.
export const METERS_PER_FLOOR = 3.2;

const HEIGHT_SOURCE_CONFIDENCE = {
  OpenStreetMap: "medium",
};

const DEFAULT_HEIGHT_BY_CLASS = {
  residential: 10,
  commercial: 20,
  industrial: 12,
  agricultural: 6,
  civic: 15,
  outbuilding: 4,
};
const DEFAULT_HEIGHT_FALLBACK = 10;

/**
 * @param {object} properties - a building or building_part feature's properties,
 *   using Overture's own field names (height, min_height, num_floors, class, heightSource)
 * @param {Array} footprint - GeoJSON-style polygon coordinates (array of rings)
 */
export function normalizeBuilding(properties, footprint) {
  const base = typeof properties.min_height === "number" ? properties.min_height : 0;

  if (typeof properties.height === "number") {
    const confidence = HEIGHT_SOURCE_CONFIDENCE[properties.heightSource] ?? "high";
    return { footprint, base, height: properties.height, source: "height", confidence };
  }

  if (typeof properties.num_floors === "number") {
    return {
      footprint,
      base,
      height: base + properties.num_floors * METERS_PER_FLOOR,
      source: "num_floors",
      confidence: "medium",
    };
  }

  const fallbackHeight = DEFAULT_HEIGHT_BY_CLASS[properties.class] ?? DEFAULT_HEIGHT_FALLBACK;
  return {
    footprint,
    base,
    height: base + fallbackHeight,
    source: "class-default",
    confidence: "low",
  };
}

/**
 * Mirrors the exact filter explore-site's own building-extrusion style specs
 * use (components/map/layers/explore/buildings/{building,building-part}/extrusion.json):
 * a `building` with has_parts=true renders nothing itself — its true massing
 * comes from its `building_part` children — and anything is_underground never
 * obstructs an above-ground sightline.
 */
export function selectOccludingFeatures(buildingFeatures, buildingPartFeatures) {
  const buildings = buildingFeatures.filter(
    (f) => !f.is_underground && !f.has_parts
  );
  const parts = buildingPartFeatures.filter((f) => !f.is_underground);
  return [...buildings, ...parts];
}

import { normalizeBuilding, selectOccludingFeatures } from "@/lib/geo/normalizeBuilding";

// A MultiPolygon building record is one or more disjoint volumes that can
// each independently block a sightline; a Polygon is just the one.
function ringSetsFromGeometry(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

/**
 * Adapts MapLibre-queried Overture building/building_part features (e.g. from
 * map.querySourceFeatures) into normalizeBuilding()'s input shape, applying
 * the same is_underground/has_parts filtering the real building-extrusion
 * style layers use (lib/geo/normalizeBuilding.js's selectOccludingFeatures).
 *
 * @param {Array<{properties: object, geometry: object}>} buildingMapFeatures
 * @param {Array<{properties: object, geometry: object}>} buildingPartMapFeatures
 */
export function buildingsFromMapFeatures(buildingMapFeatures, buildingPartMapFeatures) {
  const withGeometry = (f) => ({ ...f.properties, geometry: f.geometry });
  const occluding = selectOccludingFeatures(
    buildingMapFeatures.map(withGeometry),
    buildingPartMapFeatures.map(withGeometry)
  );

  return occluding.flatMap((props) =>
    ringSetsFromGeometry(props.geometry).map((footprint) =>
      normalizeBuilding({ ...props, heightSource: props["@height_source"] }, footprint)
    )
  );
}

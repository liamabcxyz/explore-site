import {
  defaultLayerSpecs,
  inspectLayerSpecs,
} from "@/components/map";

// Build a mapping from source-layer type → set of item IDs.
// Used to determine inspect layer visibility from visible items.
const typeToItems = {};
for (const spec of [...defaultLayerSpecs, ...inspectLayerSpecs]) {
  const meta = spec.metadata || {};
  const type = meta["overture:type"];
  const item = meta["overture:item"];
  if (type && item) {
    if (!typeToItems[type]) typeToItems[type] = new Set();
    typeToItems[type].add(item);
  }
}

/**
 * Check if a source-layer type has any visible items.
 */
export function isTypeVisible(type, visibleItems) {
  const items = typeToItems[type];
  if (!items) return false;
  for (const item of items) {
    if (visibleItems.includes(item)) return true;
  }
  return false;
}

/**
 * Convert visible items to visible source-layer type names.
 * Used by download/share features that need type-level granularity.
 */
export function getVisibleTypes(visibleItems) {
  const types = new Set();
  for (const [type, items] of Object.entries(typeToItems)) {
    for (const item of items) {
      if (visibleItems.includes(item)) {
        types.add(type);
        break;
      }
    }
  }
  return [...types];
}

// Selection highlight constants
const SELECTED = ["boolean", ["feature-state", "selected"], false];
const SELECTION_FILL = "hsla(350, 65%, 48%, 0.3)";
const SELECTION_STROKE = "hsl(350, 65%, 48%)";

/**
 * Return true if a style expression (or any nested sub-expression) contains
 * `["zoom"]`.  MapLibre requires zoom expressions to sit at the top level of
 * `step`/`interpolate`, so we must not wrap them inside `case`.
 */
function containsZoomExpression(expr) {
  if (!Array.isArray(expr)) return false;
  if (expr.length === 1 && expr[0] === "zoom") return true;
  return expr.some(containsZoomExpression);
}

/**
 * Wrap a single paint property in a feature-state case expression.
 * Skips zoom-dependent values. If the property doesn't exist, adds it
 * with `fallback` as the non-selected value.
 */
function wrapPaint(paint, key, selectedValue, fallback) {
  const original = paint[key];
  if (original !== undefined && containsZoomExpression(original)) return;
  paint[key] = ["case", SELECTED, selectedValue, original !== undefined ? original : fallback];
}

/**
 * Inject selection highlight paint for each layer type so that selected
 * features render with consistent selection styling at all zooms.
 * Mutates `paint` in place.
 *
 * Points:   semi-transparent blue circle + solid blue stroke
 * Lines:    solid blue line
 * Polygons: semi-transparent blue fill + solid blue outline
 */
function injectHighlightPaint(paint, layerType) {
  switch (layerType) {
    case "fill":
      wrapPaint(paint, "fill-color", SELECTION_FILL, "hsla(0,0%,0%,0)");
      wrapPaint(paint, "fill-outline-color", SELECTION_STROKE, "hsla(0,0%,0%,0)");
      break;
    case "line":
      wrapPaint(paint, "line-color", SELECTION_STROKE, "hsla(0,0%,0%,0)");
      wrapPaint(paint, "line-width", 4, 1);
      break;
    case "circle":
      wrapPaint(paint, "circle-color", SELECTION_FILL, "hsla(0,0%,0%,0)");
      wrapPaint(paint, "circle-stroke-color", SELECTION_STROKE, "hsla(0,0%,0%,0)");
      wrapPaint(paint, "circle-stroke-width", 2, 0);
      break;
    case "symbol":
      wrapPaint(paint, "text-color", SELECTION_STROKE, "hsl(0,0%,0%)");
      wrapPaint(paint, "icon-color", SELECTION_STROKE, "hsl(0,0%,0%)");
      break;
    case "fill-extrusion":
      wrapPaint(paint, "fill-extrusion-color", SELECTION_FILL, "hsla(0,0%,0%,0)");
      break;
  }
}

/**
 * Given a pre-built layer spec and current runtime state, return a copy with
 * visibility applied based on the active layer tree items.
 *
 * visibleItems: array of item IDs (from overture:item metadata).
 */
function applyRuntimeStyle(spec, visibleItems) {
  const meta = spec.metadata || {};
  const item = meta["overture:item"];
  const type = meta["overture:type"];

  // Compute visibility:
  // - If spec has an item, check if that item is visible
  // - If no item, check if the type has any visible items
  // - If neither, always visible (e.g. background)
  let visible;
  if (item) {
    visible = visibleItems.includes(item);
  } else if (type) {
    visible = isTypeVisible(type, visibleItems);
  } else {
    visible = true;
  }

  // Deep-clone the spec so we don't mutate the imported JSON
  const result = JSON.parse(JSON.stringify(spec));
  result.layout = result.layout || {};
  result.paint = result.paint || {};
  result.layout.visibility = visible ? "visible" : "none";

  injectHighlightPaint(result.paint, result.type);

  return result;
}

/**
 * Add the 6 vector tile sources from PMTiles URLs.
 */
export function addSources(map, pmtilesUrls) {
  const sourceNames = ["base", "buildings", "places", "divisions", "transportation", "addresses"];
  for (const name of sourceNames) {
    if (pmtilesUrls[name] && !map.getSource(name)) {
      map.addSource(name, {
        type: "vector",
        url: `pmtiles://${pmtilesUrls[name]}`,
        promoteId: "id",
      });
    }
  }
}

// AWS Terrain Tiles (Mapzen-derived, hosted on S3 as an AWS Open Data
// dataset). Terrarium encoding — see 地形高程集成_实施方案.md §2. Free,
// no auth. This is phase 1 of the terrain integration — display only;
// analysis still assumes flat ground until later phases add elevation
// sampling into the sightline math.
const AWS_TERRAIN_TILE_URL =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const AWS_TERRAIN_ATTRIBUTION =
  "Terrain © <a href=\"https://registry.opendata.aws/terrain-tiles/\" target=\"_blank\" rel=\"noopener\">Mapzen / USGS / SRTM via AWS</a>";
export const TERRAIN_SOURCE_ID = "aws-terrain";
export const HILLSHADE_LAYER_ID = "aws-terrain-hillshade";

/**
 * Registers the terrain raster-dem source. Idempotent — no-op if the
 * source is already added. Attribution is set on the source itself so
 * maplibre's own attribution control picks it up alongside the Overture
 * / OpenStreetMap strings.
 */
export function addTerrainSource(map) {
  if (map.getSource(TERRAIN_SOURCE_ID)) return;
  map.addSource(TERRAIN_SOURCE_ID, {
    type: "raster-dem",
    tiles: [AWS_TERRAIN_TILE_URL],
    encoding: "terrarium",
    tileSize: 256,
    maxzoom: 15,
    attribution: AWS_TERRAIN_ATTRIBUTION,
  });
}

/**
 * Adds the hillshade layer that draws light/shadow from the terrain
 * source. Deliberately does NOT enable `map.setTerrain()` — building
 * extrusions would clip through 3D geography and mobile perf would
 * take a hit. Hillshade renders as a flat overlay under the buildings,
 * so the map reads as top-down 2D with visible relief.
 *
 * The z-order matters: hillshade should sit above base fills (so hills
 * cast shading on land-cover), but below building extrusions (so
 * buildings still look opaque). The caller is expected to run
 * `map.moveLayer(HILLSHADE_LAYER_ID, "buildings-building-extrusion")`
 * after Overture layers land, since layer IDs there are added
 * asynchronously by addAllLayers().
 *
 * Registered hidden — most users don't want relief shading on by
 * default. TerrainToggleControl (lib/TerrainToggleControl.js) flips
 * `visibility` on when the user opts in.
 */
export function addHillshadeLayer(map) {
  if (map.getLayer(HILLSHADE_LAYER_ID)) return;
  map.addLayer({
    id: HILLSHADE_LAYER_ID,
    type: "hillshade",
    source: TERRAIN_SOURCE_ID,
    layout: {
      visibility: "none",
    },
    paint: {
      "hillshade-exaggeration": 0.5,
    },
  });
}

/**
 * Add all default layers in the order defined by the layer list.
 * Also loads any required icon images.
 */
export async function addAllLayers(map, visibleItems) {
  // Load icons from SVGs — wait for all to load before adding layers
  const iconNames = ["star", "park", "airport", "beer", "grocery", "doctor", "fuel", "golf", "convenience", "lodging", "parking", "rail", "restaurant", "shop", "ranger-station", "stadium", "circle", "circle-stroked", "circle-opt"];

  await Promise.all(
    iconNames.map((name) => {
      if (map.hasImage(name)) return Promise.resolve();
      return new Promise((resolve) => {
        const img = new Image(25, 25);
        img.onload = () => {
          if (!map.hasImage(name)) {
            map.addImage(name, img);
          }
          resolve();
        };
        img.onerror = resolve;
        img.src = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/icons/${name}.svg`;
      });
    })
  );

  for (const spec of defaultLayerSpecs) {
    const styled = applyRuntimeStyle(spec, visibleItems);
    if (!map.getLayer(styled.id)) {
      map.addLayer(styled);
    }
  }
}

/**
 * Update visibility and colors on all existing layers.
 */
export function updateLayerVisibility(map, visibleItems) {
  for (const spec of defaultLayerSpecs) {
    const styled = applyRuntimeStyle(spec, visibleItems);
    if (!map.getLayer(styled.id)) continue;

    map.setLayoutProperty(styled.id, "visibility", styled.layout.visibility);

    // Update layout properties (e.g. text-font for symbol layers)
    if (styled.layout) {
      for (const [key, value] of Object.entries(styled.layout)) {
        if (key === "visibility") continue;
        map.setLayoutProperty(styled.id, key, value);
      }
    }

    if (styled.paint) {
      for (const [key, value] of Object.entries(styled.paint)) {
        map.setPaintProperty(styled.id, key, value);
      }
    }
  }
}

/**
 * Add all inspect layers.
 */
export function addInspectLayers(map, visibleItems) {
  for (const spec of inspectLayerSpecs) {
    const styled = applyRuntimeStyle(spec, visibleItems);
    if (!map.getLayer(styled.id)) {
      map.addLayer(styled);
    }
  }
}

/**
 * Update visibility on already-added inspect layers based on visibleItems.
 */
export function updateInspectVisibility(map, visibleItems) {
  for (const spec of inspectLayerSpecs) {
    const styled = applyRuntimeStyle(spec, visibleItems);
    if (!map.getLayer(styled.id)) continue;
    map.setLayoutProperty(styled.id, "visibility", styled.layout.visibility);
  }
}

/**
 * Highlight a feature by setting feature state. Clears previous feature state.
 */
export function highlightFeature(map, newFeature, prevFeature) {
  if (prevFeature) {
    map.removeFeatureState({
      source: prevFeature.source,
      sourceLayer: prevFeature.sourceLayer,
      id: prevFeature.id,
    });
  }

  if (newFeature) {
    map.setFeatureState(
      {
        source: newFeature.source,
        sourceLayer: newFeature.sourceLayer,
        id: newFeature.id,
      },
      { selected: true }
    );
  }
}

/**
 * Get the list of layer IDs that should be interactive (clickable),
 * based on currently visible items. Excludes layers marked as non-selectable.
 */
export function getInteractiveLayerIds(map, visibleItems) {
  const style = map.getStyle();
  if (!style || !style.layers) return [];
  return style.layers
    .filter((layer) => {
      const meta = layer.metadata;
      if (meta && meta["overture:selectable"] === false) return false;

      // Check by item if available, else by source-layer type
      const item = meta?.["overture:item"];
      if (item) {
        if (!visibleItems.includes(item)) return false;
      } else {
        const sourceLayer = layer["source-layer"];
        if (!sourceLayer || !isTypeVisible(sourceLayer, visibleItems)) return false;
      }

      return true;
    })
    .map((layer) => layer.id);
}

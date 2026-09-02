// User-provided on-map annotations that ride along in a "Report a
// problem" bundle. The user places 0–3 pins to say "this specific
// building/spot on the map is the actual issue" — the app's compute
// can't know which real-world blocker is really in the way, so this is
// how the human standing at the viewpoint hands ground truth back.
//
// Data shape is deliberately flat and JSON-safe: the entire annotation
// list is embedded in the debug bundle (lib/debug/bundle.js), which
// gets copied/downloaded as-is.

/**
 * @typedef {"wrong-blocker"|"wrong-height"|"not-really-there"|"wrong-floor-count"|"other-building"} BuildingCategory
 * @typedef {"tree-here"|"small-building"|"terrain-wrong"|"other-spot"} SpotCategory
 * @typedef {BuildingCategory|SpotCategory|null} AnnotationCategory
 *
 * @typedef {object} Annotation
 * @property {string} id
 * @property {string} createdAt
 * @property {"building"|"spot"} kind
 * @property {number} lat
 * @property {number} lng
 * @property {object|null} building - filled iff kind==="building"
 * @property {AnnotationCategory} category
 * @property {string} note
 */

/**
 * User-visible labels for each category. The keys are the machine-readable
 * category slugs stored in the annotation itself; the values are the
 * plain-English strings the "Report a problem" dialog renders as buttons.
 * Non-technical language: "wrong height" instead of "height-confidence
 * mismatch", "not really there" instead of "footprint-only stub", etc.
 */
export const BUILDING_CATEGORIES = [
  { id: "wrong-blocker", label: "This isn't really what's blocking me" },
  { id: "wrong-height", label: "The height looks wrong (too tall or too short)" },
  { id: "not-really-there", label: "This building was torn down / never existed" },
  { id: "wrong-floor-count", label: "The floor count is off" },
  { id: "other-building", label: "Something else about this building" },
];

export const SPOT_CATEGORIES = [
  { id: "tree-here", label: "There's a big tree here the map doesn't have" },
  { id: "small-building", label: "There's a small building / structure here" },
  { id: "terrain-wrong", label: "The ground shape is off (hill / dip)" },
  { id: "other-spot", label: "Something else is here" },
];

export const MAX_ANNOTATIONS = 3;

// Fresh id per annotation — simple monotonic + random tail, we don't
// need collision resistance across machines (annotations only ever live
// inside one report bundle).
let seq = 0;
function nextId() {
  seq += 1;
  const rnd = Math.random().toString(36).slice(2, 6);
  return `ann-${seq}-${rnd}`;
}

/**
 * @param {{lat:number, lng:number, building?: object|null}} target
 * @returns {Annotation}
 */
export function createAnnotation(target) {
  const isBuilding = Boolean(target?.building);
  return {
    id: nextId(),
    createdAt: new Date().toISOString(),
    kind: isBuilding ? "building" : "spot",
    lat: target.lat,
    lng: target.lng,
    building: isBuilding ? {
      id: target.building.id ?? null,
      name: target.building.name ?? null,
      height: target.building.height ?? null,
      confidence: target.building.confidence ?? null,
    } : null,
    category: null,
    note: "",
  };
}

export function categoriesFor(kind) {
  return kind === "building" ? BUILDING_CATEGORIES : SPOT_CATEGORIES;
}

/**
 * Predicate for "does VANTAGE want to keep this click for itself?" — read by
 * components/MapView.jsx's own click handler so it can early-return before
 * running queryRenderedFeatures + opening the feature-inspect panel on top
 * of a launch-point placement or an observer pick. Extracted as a
 * pure function so the two conditions are testable independently of the
 * React/maplibre wiring in LaunchPointControl.jsx.
 *
 * "Placing" a launch point always wins — every click on the map places it.
 * Observer picks only capture the click while the dedicated place-observer
 * mode is on (anywhere on the map, not just inside the 1.5km heat-map
 * circle). Clicks outside those two modes stay available to MapView's
 * feature-inspect.
 *
 * @param {object} args
 * @param {boolean} args.placing
 * @param {boolean} [args.placingObserver]
 * @param {{lat:number,lng:number}|null} args.launch
 * @param {{lng:number,lat:number}} args.clickLngLat
 * @param {number} [args.analysisRadiusMeters] - unused; kept so existing
 *   call sites don't break when they still pass it.
 */
export function isVantageClick({ placing, placingObserver = false, launch, clickLngLat, analysisRadiusMeters: _analysisRadiusMeters }) {
  if (placing) return true;
  if (placingObserver && launch && clickLngLat) return true;
  return false;
}

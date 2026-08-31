import { makeLocalProjector } from "@/lib/geo/toLocalMeters";

/**
 * Predicate for "does VANTAGE want to keep this click for itself?" — read by
 * components/MapView.jsx's own click handler so it can early-return before
 * running queryRenderedFeatures + opening the feature-inspect panel on top
 * of a launch-point placement or an in-radius observer pick. Extracted as a
 * pure function so the two conditions are testable independently of the
 * React/maplibre wiring in LaunchPointControl.jsx.
 *
 * "Placing" always wins — the whole point of that mode is that every click
 * on the map places the launch point, regardless of what's underneath.
 * Observer picks (once a launch point exists) only capture the click when
 * inside the analysis radius, matching the exact guard
 * LaunchPointControl.jsx's observer-click listener already uses; a click
 * outside the radius stays available to MapView's feature-inspect just like
 * any other spot on the map.
 *
 * @param {object} args
 * @param {boolean} args.placing
 * @param {{lat:number,lng:number}|null} args.launch
 * @param {{lng:number,lat:number}} args.clickLngLat
 * @param {number} args.analysisRadiusMeters
 */
export function isVantageClick({ placing, launch, clickLngLat, analysisRadiusMeters }) {
  if (placing) return true;
  if (!launch) return false;
  const projector = makeLocalProjector(launch.lat, launch.lng);
  const { x, y } = projector.toLocal(clickLngLat.lat, clickLngLat.lng);
  return Math.hypot(x, y) <= analysisRadiusMeters;
}

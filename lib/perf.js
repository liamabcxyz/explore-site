// Lightweight fire-and-forget diagnostic channel between the viewshed
// compute pipeline (components/launch/LaunchPointControl.jsx) and the debug
// HUD (components/launch/PerfOverlay.jsx) — a plain window CustomEvent
// rather than React state/context, since this is dev-only instrumentation
// with no reason to live in the render tree's data flow.
const EVENT_NAME = "vantage:viewshed-perf";

// Retain the most recent metrics so a debug-report bundle
// (lib/debug/bundle.js) can snapshot them without also becoming a
// long-lived subscriber. `reportViewshedPerf` already runs every time a
// launch/observer change fires the worker, so this is guaranteed to
// hold the numbers matching whatever analysis the bundle is about to
// serialize.
let lastViewshedPerf = null;

export function reportViewshedPerf(detail) {
  lastViewshedPerf = detail;
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
}

export function onViewshedPerf(callback) {
  if (typeof window === "undefined") return () => {};
  const handler = (e) => callback(e.detail);
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}

/**
 * Sync read of the last dispatched viewshed perf detail. Returns null if
 * no analysis has run yet. Never triggers a subscription — see
 * `onViewshedPerf` for the pub/sub path used by PerfOverlay.
 */
export function getLatestViewshedPerf() {
  return lastViewshedPerf;
}

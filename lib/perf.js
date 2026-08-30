// Lightweight fire-and-forget diagnostic channel between the viewshed
// compute pipeline (components/launch/LaunchPointControl.jsx) and the debug
// HUD (components/launch/PerfOverlay.jsx) — a plain window CustomEvent
// rather than React state/context, since this is dev-only instrumentation
// with no reason to live in the render tree's data flow.
const EVENT_NAME = "vantage:viewshed-perf";

export function reportViewshedPerf(detail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
}

export function onViewshedPerf(callback) {
  if (typeof window === "undefined") return () => {};
  const handler = (e) => callback(e.detail);
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}

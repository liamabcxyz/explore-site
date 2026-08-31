import { computeViewshed } from "@/lib/viewshed/computeViewshed";
import { computeRooftopLayer } from "@/lib/viewshed/computeRooftopLayer";

// Both computed on every request and returned together — the rooftop
// building layer is cheap relative to the ground grid (one result per
// building rather than per grid cell) and the caller toggles which one is
// visible purely client-side, with no recompute on toggle. See
// components/launch/LaunchPointControl.jsx.
self.onmessage = (event) => {
  const grid = computeViewshed(event.data);
  const rooftop = computeRooftopLayer(event.data);
  self.postMessage({ grid, rooftop });
};

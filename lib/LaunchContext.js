"use client";

import { createContext, useContext } from "react";

// Shared read channel between LaunchPointControl (producer, sits outside
// MapView) and ProfilePanel (consumer, sits inside MapView -> SidePanel) —
// avoids threading launch/profile state down through MapView.jsx's own
// props, matching how lib/MapContext.js already surfaces the map instance
// across the same boundary.
const LaunchContext = createContext(null);

export function useLaunchAnalysis() {
  return useContext(LaunchContext);
}

export default LaunchContext;

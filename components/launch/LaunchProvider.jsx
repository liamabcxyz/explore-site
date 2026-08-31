"use client";

import { useState } from "react";
import LaunchContext from "@/lib/LaunchContext";

// Thin state bucket, no business logic — LaunchPointControl writes the
// analysis, ProfilePanel reads it. See lib/LaunchContext.js.
//
// viewerLevel is separate from analysis: it's the user's own choice of how
// high up they are at the selected observer point (ground / a floor / the
// roof, when that point sits on a building — see lib/geo/rooftopBase.js's
// findBuildingAt), read by LaunchPointControl to decide the observer height
// it feeds into computeSightlineProfile, and written by ProfilePanel's
// selector control. { mode: "ground" } is the default and matches
// computeSightlineProfile's own default (EYE_HEIGHT) exactly.
export default function LaunchProvider({ children }) {
  const [analysis, setAnalysis] = useState(null);
  const [viewerLevel, setViewerLevel] = useState({ mode: "ground", floor: 1 });

  return (
    <LaunchContext.Provider value={{ analysis, setAnalysis, viewerLevel, setViewerLevel }}>
      {children}
    </LaunchContext.Provider>
  );
}

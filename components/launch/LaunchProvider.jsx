"use client";

import { useState } from "react";
import LaunchContext from "@/lib/LaunchContext";

// Thin state bucket, no business logic — LaunchPointControl writes the
// analysis, ProfilePanel reads it. See lib/LaunchContext.js.
export default function LaunchProvider({ children }) {
  const [analysis, setAnalysis] = useState(null);

  return (
    <LaunchContext.Provider value={{ analysis, setAnalysis }}>
      {children}
    </LaunchContext.Provider>
  );
}

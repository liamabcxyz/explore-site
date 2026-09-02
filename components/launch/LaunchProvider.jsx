"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
//
// setClickCapturePredicate / isVantageClickAt together answer "is VANTAGE
// keeping this click for itself?" LaunchPointControl calls the setter
// whenever its own placing/launch state changes, storing the current
// predicate inside a ref that lives in this provider (React 19 forbids
// callers from mutating a ref they receive from context, so the mutation
// stays where the ref was constructed). MapView.jsx's own click handler
// then calls isVantageClickAt and early-returns for those clicks, so a
// launch-point placement (or an observer pick in place-observer mode) doesn't also pop
// MapView's feature-inspect panel on whatever building sat under the
// click. Both setter and reader are stable useCallback values so the
// consumers don't re-run on every render.
export default function LaunchProvider({ children }) {
  const [analysis, setAnalysis] = useState(null);
  const [viewerLevel, setViewerLevel] = useState({ mode: "ground", floor: 1 });
  const clickCaptureRef = useRef(() => false);
  const setClickCapturePredicate = useCallback((fn) => {
    clickCaptureRef.current = fn ?? (() => false);
  }, []);
  const isVantageClickAt = useCallback((lngLat) => clickCaptureRef.current(lngLat), []);

  // Annotations captured by the "Report a problem" flow — see
  // components/analysis/ReportProblemDialog.jsx and
  // components/analysis/AnnotationLayer.jsx. Stored here (not per-dialog-
  // instance) so the pins survive dialog close/reopen and the MapView's
  // click handler can address them without prop-drilling. `annotationMode`
  // is a boolean "am I currently arming the next map click to become an
  // annotation?" — set true by the dialog, cleared by MapView after the
  // click lands.
  const [annotations, setAnnotations] = useState([]);
  const [annotationMode, setAnnotationMode] = useState(false);
  // Ref-mirror of annotationMode so MapView's one-shot mount-time click
  // handler (which captures LaunchContext at first render only, matching
  // how isVantageClickAt is threaded) can always read the current value
  // without needing to re-subscribe. Same trick as clickCaptureRef above.
  const annotationModeRef = useRef(false);
  useEffect(() => {
    annotationModeRef.current = annotationMode;
  }, [annotationMode]);
  const isArmingAnnotation = useCallback(() => annotationModeRef.current, []);

  const value = useMemo(
    () => ({
      analysis,
      setAnalysis,
      viewerLevel,
      setViewerLevel,
      setClickCapturePredicate,
      isVantageClickAt,
      annotations,
      setAnnotations,
      annotationMode,
      setAnnotationMode,
      isArmingAnnotation,
    }),
    [analysis, viewerLevel, setClickCapturePredicate, isVantageClickAt, annotations, annotationMode, isArmingAnnotation]
  );

  return <LaunchContext.Provider value={value}>{children}</LaunchContext.Provider>;
}

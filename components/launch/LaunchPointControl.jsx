"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { Paper, Button, Typography, Slider, Stack, Switch, FormControlLabel } from "@mui/material";
import { useMapInstance } from "@/lib/MapContext";
import { useLaunchAnalysis } from "@/lib/LaunchContext";
import { makeLocalProjector } from "@/lib/geo/toLocalMeters";
import { buildingsFromMapFeatures } from "@/lib/geo/overtureBuildingAdapter";
import { filterBuildingsNearPoint } from "@/lib/geo/buildingsNearPoint";
import { findRooftopBase, findBuildingAt } from "@/lib/geo/rooftopBase";
import { METERS_PER_FLOOR } from "@/lib/geo/normalizeBuilding";
import { reportViewshedPerf } from "@/lib/perf";
import { EYE_HEIGHT } from "@/lib/viewshed/scoring";
import { computeSightlineProfile } from "@/lib/viewshed/computeProfile";
import { deriveShellParams, STANDARD_CALIBERS_INCHES } from "@/lib/viewshed/caliber";

// 1500m covers the full comfortable viewing ring even for a 12" shell.
// Was dropped to 500m as a stopgap while placing a launch point froze the
// main thread; now that computeViewshed runs in a Worker (lib/viewshed/worker.js)
// and querySourceFeatures results are clipped to this radius before scoring
// (lib/geo/buildingsNearPoint.js), raising it back doesn't reintroduce that —
// it does mean more cells (37 rings x 60 sectors ≈ 2220) for the Worker to
// churn through per request, worth checking against PerfOverlay's numbers.
const ANALYSIS_RADIUS = 1500;
const RADIAL_SPACING = 40; // meters between rings
const ANGULAR_SPACING = 6; // degrees between sectors — 60 sectors per ring
const SOURCE_ID = "vantage-viewshed";
const LAYER_ID = "vantage-viewshed-sectors";
// The rooftop layer (lib/viewshed/computeRooftopLayer.js) — one feature per
// building, painted onto that building's own real footprint. Kept as a
// second source/layer rather than merged into the ground grid's, so
// toggling it is a pure client-side visibility flip (no recompute) — see
// the "Register the viewshed source/layer" effect and the visibility-sync
// effect below.
const ROOFTOP_SOURCE_ID = "vantage-viewshed-rooftop";
const ROOFTOP_LAYER_ID = "vantage-viewshed-rooftop-buildings";

export default function LaunchPointControl() {
  const map = useMapInstance();
  const launchAnalysis = useLaunchAnalysis();
  const setAnalysis = launchAnalysis?.setAnalysis;
  // Memoized so the fallback object (only used if this ever renders outside
  // a LaunchProvider) doesn't change identity every render and thrash the
  // profile effect's dependency array below.
  const contextViewerLevel = launchAnalysis?.viewerLevel;
  const viewerLevel = useMemo(
    () => contextViewerLevel ?? { mode: "ground", floor: 1 },
    [contextViewerLevel]
  );
  const setViewerLevel = launchAnalysis?.setViewerLevel;
  const [placing, setPlacing] = useState(false);
  const [launch, setLaunch] = useState(null);
  // Caliber drives both burst height and shell radius (烟花可视性数学模型.md
  // §1.4) — no manual override of the derived values, since letting a user
  // set height/radius independently is exactly the physically-inconsistent-
  // combination bug this replaces.
  const [caliber, setCaliber] = useState(3);
  const { targetHeight: caliberHeight, shellRadius } = deriveShellParams(caliber);
  // A launch point placed on a rooftop/terrace burns from that roof's height,
  // not from z=0 ground — deriveShellParams stays a pure "caliber -> height
  // above the pad" function; this is a separate additive term computed
  // whenever the launch point (or the buildings under it) changes. See
  // lib/geo/rooftopBase.js and todo.md P1-3.
  const [rooftopBase, setRooftopBase] = useState(0);
  const targetHeight = caliberHeight + rooftopBase;
  // Whether the per-building rooftop layer is shown on top of the (always
  // ground-level) grid. Purely a display toggle — both layers are computed
  // together on every request (see the grid effect below), so flipping this
  // is instant, no recompute. Deliberately not linked to the single
  // observer point's ground/floor/roof picker (viewerLevel, above): this
  // answers "what does the area look like if rooftop access were
  // universal," a different question from "can I see it from this one
  // specific spot I picked."
  const [showRooftopLayer, setShowRooftopLayer] = useState(false);
  const [observer, setObserver] = useState(null);
  const markerRef = useRef(null);
  const observerMarkerRef = useRef(null);
  const placingRef = useRef(placing);
  const workerRef = useRef(null);
  // Bumped on every grid request so a response that arrives after a newer
  // request was already sent (rapid caliber drags, mainly) gets ignored
  // instead of overwriting the map with stale data — see the grid effect
  // below for how this is used.
  const requestIdRef = useRef(0);

  useEffect(() => {
    placingRef.current = placing;
  }, [placing]);

  // The actual O(cells x buildings) viewshed math now runs off the main
  // thread (lib/viewshed/worker.js is the same computeViewshed() the grid
  // effect used to call directly) so placing/moving a launch point doesn't
  // freeze the map while it's computing. One worker for the component's
  // lifetime, not one per request.
  useEffect(() => {
    const worker = new Worker(new URL("../../lib/viewshed/worker.js", import.meta.url));
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  // Register the viewshed source/layer once the style is ready.
  useEffect(() => {
    if (!map) return;
    const setup = () => {
      if (map.getSource(SOURCE_ID)) return;
      map.addSource(SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      // Polar (ring x sector) polygons rather than point markers — filled and
      // butted up against each other, this reads as rays/rings radiating out
      // from the launch marker instead of a scattered dot grid.
      map.addLayer({
        id: LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          // Colored by the discrete `category` (lib/viewshed/scoring.js's
          // visibilityCategory), not the continuous `score` — a cell that's
          // fully clear but at an uncomfortable angle and a cell that's
          // actually blocked by a building both score 0, but they're
          // different problems and used to render as the same red. "blocked"
          // and "poor-angle" get genuinely different hues so that distinction
          // survives onto the map; `frac`/`score` are still in each cell's
          // properties for anyone who wants the underlying numbers.
          "fill-color": [
            "match", ["get", "category"],
            "blocked", "#d32f2f",
            "poor-angle", "#7e57c2",
            "partial", "#fbc02d",
            "good", "#2e7d32",
            "#9e9e9e",
          ],
          "fill-opacity": 0.55,
          "fill-outline-color": "rgba(0,0,0,0.15)",
        },
      });

      if (map.getSource(ROOFTOP_SOURCE_ID)) return;
      map.addSource(ROOFTOP_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      // Same category-color language as the ground layer, but each feature
      // is a real building footprint rather than a sector wedge — the whole
      // point of computing this per building instead of per grid cell.
      map.addLayer({
        id: ROOFTOP_LAYER_ID,
        type: "fill",
        source: ROOFTOP_SOURCE_ID,
        layout: { visibility: "none" },
        paint: {
          "fill-color": [
            "match", ["get", "category"],
            "blocked", "#d32f2f",
            "poor-angle", "#7e57c2",
            "partial", "#fbc02d",
            "good", "#2e7d32",
            "#9e9e9e",
          ],
          "fill-opacity": 0.85,
          "fill-outline-color": "rgba(255,255,255,0.6)",
        },
      });
    };
    if (map.isStyleLoaded()) setup();
    else map.once("idle", setup);
  }, [map]);

  // Pure visibility flip, no recompute — both layers are already computed
  // and sitting in their sources whenever a launch point exists (see the
  // grid effect below).
  useEffect(() => {
    if (!map || !map.getLayer(ROOFTOP_LAYER_ID)) return;
    map.setLayoutProperty(ROOFTOP_LAYER_ID, "visibility", showRooftopLayer ? "visible" : "none");
  }, [map, showRooftopLayer]);

  // Click-to-place — a separate listener from MapView's own click handler,
  // so this stays fully additive with no changes to MapView.jsx. Known rough
  // edge: clicking directly on a building while placing also still opens
  // MapView's own feature-inspect panel underneath.
  useEffect(() => {
    if (!map) return;
    const onClick = (e) => {
      if (!placingRef.current) return;
      setLaunch({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      setObserver(null); // stale profile pointed at the old launch location
      setPlacing(false);
    };
    map.on("click", onClick);
    return () => map.off("click", onClick);
  }, [map]);

  // Click-to-pick an observer point for the profile view — a third
  // independent listener, active once a launch point exists and we're not
  // mid-placement. Uses the exact clicked lat/lng rather than requiring a
  // pixel-perfect hit on a rendered grid dot, and is clamped to the same
  // radius the grid itself covers so the profile always has queried building
  // data to work with.
  useEffect(() => {
    if (!map || !launch) return;
    const projector = makeLocalProjector(launch.lat, launch.lng);
    const onClick = (e) => {
      if (placingRef.current) return;
      const { x, y } = projector.toLocal(e.lngLat.lat, e.lngLat.lng);
      if (Math.hypot(x, y) > ANALYSIS_RADIUS) return;
      setObserver({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      // A fresh point may not even be on a building — start over rather than
      // carrying e.g. "rooftop" from whatever the last point was.
      if (setViewerLevel) setViewerLevel({ mode: "ground", floor: 1 });
    };
    map.on("click", onClick);
    return () => map.off("click", onClick);
  }, [map, launch, setViewerLevel]);

  useEffect(() => {
    if (!map) return;
    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
    if (launch) {
      markerRef.current = new maplibregl.Marker({ color: "#ff5722" })
        .setLngLat([launch.lng, launch.lat])
        .addTo(map);
    }
  }, [map, launch]);

  // Observer marker — a person icon rather than another colored pin, so it
  // reads as "this is where you're standing" and isn't confused with the
  // launch point's pin at a glance.
  useEffect(() => {
    if (!map) return;
    if (observerMarkerRef.current) {
      observerMarkerRef.current.remove();
      observerMarkerRef.current = null;
    }
    if (observer) {
      const el = document.createElement("div");
      el.textContent = "🧍";
      el.style.fontSize = "28px";
      el.style.lineHeight = "1";
      el.style.filter = "drop-shadow(0 1px 2px rgba(0,0,0,0.6))";
      observerMarkerRef.current = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([observer.lng, observer.lat])
        .addTo(map);
    }
  }, [map, observer]);

  useEffect(() => {
    if (!map || !map.getSource(SOURCE_ID)) return;
    // MapView adds its own ~100 layers asynchronously as PMTiles sources load,
    // which can land after this component's own setup effect and bury the
    // fill layer underneath all of them. Bump it back to the top whenever
    // the user actually interacts, rather than fighting that load order.
    if (map.getLayer(LAYER_ID)) map.moveLayer(LAYER_ID);
    if (map.getLayer(ROOFTOP_LAYER_ID)) map.moveLayer(ROOFTOP_LAYER_ID);

    if (!launch) {
      map.getSource(SOURCE_ID).setData({ type: "FeatureCollection", features: [] });
      if (map.getSource(ROOFTOP_SOURCE_ID)) {
        map.getSource(ROOFTOP_SOURCE_ID).setData({ type: "FeatureCollection", features: [] });
      }
      setRooftopBase(0);
      return;
    }

    const worker = workerRef.current;
    if (!worker) return;

    const queryStart = performance.now();
    const buildingFeats = map.querySourceFeatures("buildings", { sourceLayer: "building" });
    const partFeats = map.querySourceFeatures("buildings", { sourceLayer: "building_part" });
    const allBuildings = buildingsFromMapFeatures(buildingFeats, partFeats);
    // Nothing farther than the analysis radius from the launch point can
    // ever sit on a sightline the grid tests — cutting them here shrinks the
    // O(cells x buildings) cost itself, not just where it runs. Without this
    // `buildings` was everything querySourceFeatures happened to have
    // loaded for the current viewport, often thousands of buildings the
    // occlusion math never needed to look at.
    const buildings = filterBuildingsNearPoint(allBuildings, launch, ANALYSIS_RADIUS);
    const queryMs = performance.now() - queryStart;

    // Computed fresh here (not read from the `rooftopBase` state var) so the
    // request below always uses the value that matches the buildings just
    // queried — the state update is for display purposes (the caption below)
    // and only takes effect on the next render.
    const rooftop = findRooftopBase(launch, buildings);
    setRooftopBase(rooftop);

    const requestId = ++requestIdRef.current;
    const computeStart = performance.now();
    worker.addEventListener(
      "message",
      (e) => {
        if (requestId !== requestIdRef.current) return; // superseded by a newer request
        const computeMs = performance.now() - computeStart;
        const { grid, rooftop: rooftopLayer } = e.data;
        map.getSource(SOURCE_ID).setData(grid);
        if (map.getSource(ROOFTOP_SOURCE_ID)) map.getSource(ROOFTOP_SOURCE_ID).setData(rooftopLayer);
        reportViewshedPerf({
          queryMs,
          computeMs,
          buildingCount: buildings.length,
          cellCount: grid.features.length,
          rooftopCount: rooftopLayer.features.length,
        });
      },
      { once: true }
    );
    worker.postMessage({
      launch,
      targetHeight: caliberHeight + rooftop,
      shellRadius,
      analysisRadius: ANALYSIS_RADIUS,
      radialSpacing: RADIAL_SPACING,
      angularSpacing: ANGULAR_SPACING,
      buildings,
    });
  }, [map, launch, caliberHeight, shellRadius]);

  // Full sightline breakdown for whichever point the user picked, published
  // to LaunchContext so ProfilePanel (mounted elsewhere, inside SidePanel)
  // can render it. Re-queries buildings independently rather than sharing
  // the grid effect above — this is a single cheap query, not worth
  // restructuring the already-working grid effect to share it.
  useEffect(() => {
    if (!setAnalysis) return;
    if (!launch) {
      setAnalysis(null);
      return;
    }
    if (!map || !observer) {
      setAnalysis({ launch, targetHeight, shellRadius, caliber, observer: null, observerBuilding: null, profile: null });
      return;
    }

    const buildingFeats = map.querySourceFeatures("buildings", { sourceLayer: "building" });
    const partFeats = map.querySourceFeatures("buildings", { sourceLayer: "building_part" });
    const allBuildings = buildingsFromMapFeatures(buildingFeats, partFeats);
    const buildings = filterBuildingsNearPoint(allBuildings, launch, ANALYSIS_RADIUS);

    // Mirror of the launch-point rooftop check above, but for the other end
    // of the sightline — if the observer point sits on a building, standing
    // at ground level isn't the only option. See lib/geo/rooftopBase.js and
    // todo.md's "observer on a building" item.
    const building = findBuildingAt(observer, buildings);
    const maxFloors = building ? Math.max(1, Math.round(building.height / METERS_PER_FLOOR)) : 0;
    let observerHeight = EYE_HEIGHT;
    if (building && viewerLevel.mode === "rooftop") {
      observerHeight = building.height + EYE_HEIGHT;
    } else if (building && viewerLevel.mode === "floor") {
      const floor = Math.min(Math.max(1, viewerLevel.floor), maxFloors);
      observerHeight = (floor - 1) * METERS_PER_FLOOR + EYE_HEIGHT;
    }

    const profile = computeSightlineProfile({
      observer,
      launch,
      targetHeight,
      shellRadius,
      buildings,
      observerHeight,
    });

    const observerBuilding = building ? { ...building, maxFloors } : null;
    setAnalysis({ launch, targetHeight, shellRadius, caliber, observer, observerBuilding, profile });
  }, [map, launch, observer, targetHeight, shellRadius, caliber, viewerLevel, setAnalysis]);

  return (
    <Paper
      elevation={4}
      sx={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1200,
        p: 2,
        width: 300,
      }}
    >
      <Stack spacing={1.5}>
        <Button variant={placing ? "contained" : "outlined"} onClick={() => setPlacing((p) => !p)}>
          {placing ? "Click the map to place…" : launch ? "Move launch point" : "Set launch point"}
        </Button>
        {launch && (
          <>
            <Typography variant="caption">
              Caliber: {caliber}&quot; · burst ~{Math.round(targetHeight)}m
              {rooftopBase > 0 && ` (incl. ${Math.round(rooftopBase)}m rooftop)`}
              {" "}· shell ~{Math.round(shellRadius)}m · {ANALYSIS_RADIUS / 1000} km radius
            </Typography>
            <Slider
              min={3}
              max={12}
              step={null}
              marks={STANDARD_CALIBERS_INCHES.map((c) => ({ value: c, label: `${c}"` }))}
              value={caliber}
              onChangeCommitted={(_, v) => setCaliber(v)}
            />
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={showRooftopLayer}
                  onChange={(e) => setShowRooftopLayer(e.target.checked)}
                />
              }
              label="Show rooftop view"
            />
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              🔴 blocked by a building · 🟣 clear but a bad angle (too close/far) · 🟡 partially blocked · 🟢 good spot
              {showRooftopLayer && " — bright outlines are buildings, colored by what their own roof can see"}
            </Typography>
            <Button
              size="small"
              onClick={() => {
                setLaunch(null);
                setObserver(null);
              }}
            >
              Clear
            </Button>
          </>
        )}
      </Stack>
    </Paper>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { Box, Paper, Button, Typography, Slider, Stack, Switch, FormControlLabel, Menu, MenuItem } from "@mui/material";
import { useMapInstance } from "@/lib/MapContext";
import { useLaunchAnalysis } from "@/lib/LaunchContext";
import { createHiddenBuildingSource } from "@/lib/HiddenBuildingSource";
import { isVantageClick } from "@/lib/launchClickCapture";
import { parseLaunchUrlState, writeLaunchUrlState } from "@/lib/launchUrlState";
import { makeLocalProjector } from "@/lib/geo/toLocalMeters";
import { buildingsFromMapFeatures } from "@/lib/geo/overtureBuildingAdapter";
import { filterBuildingsNearPoint } from "@/lib/geo/buildingsNearPoint";
import { loadBuildingsAlongCorridor, CORRIDOR_BUFFER_METERS } from "@/lib/geo/corridorBuildings";
import { findRooftopBase, findBuildingAt } from "@/lib/geo/rooftopBase";
import { METERS_PER_FLOOR } from "@/lib/geo/normalizeBuilding";
import { reportViewshedPerf } from "@/lib/perf";
import { EYE_HEIGHT } from "@/lib/viewshed/scoring";
import { computeSightlineProfile } from "@/lib/viewshed/computeProfile";
import { pickTopSpots } from "@/lib/viewshed/pickTopSpots";
import { loadElevationGridForBounds, loadElevationGridForCorridor, TERRAIN_TILE_ZOOM } from "@/lib/viewshed/ElevationGrid";
import { tileDistanceSpan } from "@/lib/viewshed/tileWalk";
import { sightlineMapData } from "@/lib/viewshed/sightlineLayer";
import { deriveShellParams, STANDARD_CALIBERS_INCHES } from "@/lib/viewshed/caliber";
import { FIREWORKS_PRESETS } from "@/lib/fireworksPresets";
// Read from the standalone state store so this doesn't force stacService's
// stac-js ESM import into any test transitively including this file.
import { getPinnedReleaseId } from "@/lib/stacReleaseState";

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
const SIGHTLINE_SOURCE_ID = "vantage-sightline";
const SIGHTLINE_LAYER_ID = "vantage-sightline-line";
const BLOCKER_SOURCE_ID = "vantage-sightline-blocker";
const BLOCKER_LAYER_ID = "vantage-sightline-blocker-fill";

// Legend entries, in the same visual order as the paint expression above so
// a reader glancing between panel and map matches them by row position, not
// by re-reading each label. Colors are the literal fill values from
// scoring.js's `visibilityCategory` mapping (kept in sync manually; there
// aren't enough of them to justify hoisting a shared constants module).
const LEGEND_ENTRIES = [
  { color: "#2e7d32", label: "Good spot" },
  { color: "#fbc02d", label: "Partially blocked" },
  { color: "#7e57c2", label: "Bad viewing angle (too close or far)" },
  { color: "#d32f2f", label: "Blocked by a building" },
];

// Only added to the legend when the rooftop overlay is visible — the mixed
// category is a per-building call that doesn't exist for ground-grid cells,
// so showing it alongside the ground legend would be a lie.
const ROOFTOP_LEGEND_EXTRA = {
  color: "#9e9e9e",
  label: "Large roof — partly visible",
};

// Global CSS for the firework animation. Rendered as a plain <style>
// element (not scoped) because the elements being styled are created via
// document.createElement and handed to a maplibre Marker — they aren't
// React children, so JSX-scoped CSS-in-JS wouldn't reach them. The rules
// use the vantage-fw- prefix to keep the class-name namespace polluted
// only in an intentionally scoped way.
//
// The animation has four layered pieces, all in screen space (a literal
// altitude visualization would need a 3D scene; this is decoration):
//   1. Rise — a bright dot with a trailing streak climbs to the apex.
//   2. Flash — a bright white/orange radial pulse at the apex marks the
//      burst moment.
//   3. Particles — 60 small glowing dots fly outward from the apex on
//      per-particle angles + distances (set via --dx/--dy CSS vars) with
//      a gravity droop in the second half and a color/hue per-particle
//      (via --hue). Real fireworks are hundreds of independent points
//      arcing with gravity in mixed colors; this ports that structure
//      into pure CSS.
//   4. Smoke — a soft grey fade lingers briefly at the burst position so
//      the burst doesn't just vanish cleanly.
const FIREWORK_CSS = `
@keyframes vantage-fw-rise {
  0%   { transform: translate(-3px, 0);      opacity: 1; }
  100% { transform: translate(-3px, -140px); opacity: 1; }
}
@keyframes vantage-fw-rise-fade {
  0%, 92% { opacity: 1; }
  100%    { opacity: 0; }
}
@keyframes vantage-fw-flash {
  0%, 35% { transform: translate(-30px, -155px) scale(0);   opacity: 0; }
  40%     { transform: translate(-30px, -155px) scale(0.3); opacity: 1; }
  55%     { transform: translate(-30px, -155px) scale(1);   opacity: 0.85; }
  100%    { transform: translate(-30px, -155px) scale(1.6); opacity: 0; }
}
@keyframes vantage-fw-particle {
  0%   { transform: translate(-2px, -140px);           opacity: 1; }
  55%  { transform: translate(calc(-2px + var(--dx) * 0.65),
                              calc(-140px + var(--dy) * 0.65));
         opacity: 1; }
  100% { transform: translate(calc(-2px + var(--dx)),
                              calc(-140px + var(--dy) + 45px));
         opacity: 0; }
}
@keyframes vantage-fw-smoke {
  0%, 45% { transform: translate(-40px, -170px) scale(0);   opacity: 0; }
  55%     { transform: translate(-40px, -170px) scale(0.6); opacity: 0.35; }
  100%    { transform: translate(-40px, -190px) scale(1.4); opacity: 0; }
}
.vantage-fw-trail {
  position: absolute; left: 0; bottom: 0;
  width: 6px; height: 6px;
  background: radial-gradient(circle, #fff 0%, #ffe08a 45%, rgba(255,224,138,0) 75%);
  border-radius: 50%;
  box-shadow:
    0 8px  4px  -1px rgba(255,224,138,0.75),
    0 16px 6px  -2px rgba(255,190, 90,0.55),
    0 24px 8px  -3px rgba(255,150, 60,0.35),
    0 32px 10px -4px rgba(255,120, 40,0.15);
  animation:
    vantage-fw-rise 700ms cubic-bezier(0.18, 0.7, 0.35, 1) forwards,
    vantage-fw-rise-fade 800ms linear forwards;
}
.vantage-fw-flash {
  position: absolute; left: 0; bottom: 0;
  width: 60px; height: 60px;
  background: radial-gradient(circle, rgba(255,255,255,0.95) 0%,
    rgba(255,220,140,0.75) 25%, rgba(255,150,60,0.4) 50%, rgba(255,80,40,0) 72%);
  border-radius: 50%;
  mix-blend-mode: screen;
  animation: vantage-fw-flash 900ms ease-out 700ms forwards;
}
.vantage-fw-particle {
  position: absolute; left: 0; bottom: 0;
  width: 4px; height: 4px;
  border-radius: 50%;
  background: radial-gradient(circle, #fff 0%,
    hsl(var(--hue) 100% 65%) 40%,
    hsla(var(--hue) 100% 55% / 0) 72%);
  box-shadow: 0 0 5px 1px hsla(var(--hue) 100% 65% / 0.75);
  mix-blend-mode: screen;
  animation: vantage-fw-particle 1600ms cubic-bezier(0.15, 0.7, 0.35, 1) 750ms forwards;
}
.vantage-fw-smoke {
  position: absolute; left: 0; bottom: 0;
  width: 80px; height: 80px;
  background: radial-gradient(circle, rgba(200,200,210,0.55) 0%,
    rgba(180,180,190,0.3) 40%, rgba(160,160,170,0) 70%);
  border-radius: 50%;
  filter: blur(6px);
  animation: vantage-fw-smoke 1800ms ease-out 900ms forwards;
}
`;

// Palette — pick a random one per burst so consecutive fireworks look
// different. Each entry is a list of hues (0-360) the particles draw from.
// Warm mixes read as classic Chinese/American fireworks; the mixed set
// reads as a modern professional display.
const FIREWORK_PALETTES = [
  { name: "gold-red", hues: [45, 30, 15, 5, 350] },
  { name: "chrysanthemum", hues: [50, 40, 30, 25, 20, 15] },
  { name: "peacock", hues: [200, 190, 170, 150, 130] },
  { name: "rainbow", hues: [0, 45, 90, 135, 180, 225, 270, 315] },
  { name: "willow", hues: [40, 30, 20, 15, 10] },
];

// Build the marker's inner HTML — trail, flash, N particles with per-
// particle angle/distance/hue via CSS variables, smoke. Returns a plain
// HTML string so the caller can `el.innerHTML = ...` without doing any
// DOM construction itself.
function buildFireworkHtml() {
  const palette = FIREWORK_PALETTES[Math.floor(Math.random() * FIREWORK_PALETTES.length)];
  const particleCount = 60;
  const parts = ['<div class="vantage-fw-smoke"></div>'];
  parts.push('<div class="vantage-fw-flash"></div>');
  parts.push('<div class="vantage-fw-trail"></div>');
  for (let i = 0; i < particleCount; i++) {
    // Even angular distribution with a small jitter so particles don't
    // look uniformly grid-spaced (real bursts are irregular).
    const baseAngle = (i / particleCount) * Math.PI * 2;
    const angle = baseAngle + (Math.random() - 0.5) * 0.25;
    // Radial distance jitter so some particles fly further than others,
    // giving the burst thickness.
    const distance = 90 + Math.random() * 60;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;
    const hue = palette.hues[Math.floor(Math.random() * palette.hues.length)];
    const delay = Math.random() * 60; // ms stagger — tiny, mostly synchronous
    parts.push(
      `<div class="vantage-fw-particle" style="--dx:${dx.toFixed(1)}px;--dy:${dy.toFixed(1)}px;--hue:${hue};animation-delay:${750 + delay}ms"></div>`
    );
  }
  return parts.join("");
}

function LegendSwatch({ color }) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-block",
        width: 14,
        height: 14,
        borderRadius: 0.5,
        bgcolor: color,
        flexShrink: 0,
      }}
    />
  );
}

function LegendRow({ color, label }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <LegendSwatch color={color} />
      <Typography variant="caption" sx={{ color: "text.secondary" }}>{label}</Typography>
    </Stack>
  );
}

export default function LaunchPointControl() {
  const map = useMapInstance();
  const launchAnalysis = useLaunchAnalysis();
  const setAnalysis = launchAnalysis?.setAnalysis;
  const setClickCapturePredicate = launchAnalysis?.setClickCapturePredicate;
  // Read once, at first render, on the client (SSR safe — "use client" file
  // but the useState initializer still needs the window guard for Jest and
  // for the split second before hydration reaches this component tree).
  // Passing a function to useState means this only runs once, not per render.
  const [urlInitialState] = useState(() => {
    if (typeof window === "undefined") return {};
    return parseLaunchUrlState(window.location.search);
  });
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
  const [placingObserver, setPlacingObserver] = useState(false);
  const [presetMenuAnchor, setPresetMenuAnchor] = useState(null);
  const [launch, setLaunch] = useState(() => urlInitialState.launch ?? null);
  // Preset id if a real-show was picked from the menu. Written to the URL
  // as `?preset=<id>` for informational value — the receiver of a shared
  // link (or a bug report) can see "the user was looking at Macy's" rather
  // than reverse-engineering it from coordinates. Cleared automatically
  // when the user manually moves the launch point, since the preset id
  // no longer applies to whatever custom spot they've picked.
  const [selectedPresetId, setSelectedPresetId] = useState(() => urlInitialState.presetId ?? null);
  // Caliber drives both burst height and shell radius (烟花可视性数学模型.md
  // §1.4) — no manual override of the derived values, since letting a user
  // set height/radius independently is exactly the physically-inconsistent-
  // combination bug this replaces.
  const [caliber, setCaliber] = useState(() => urlInitialState.caliber ?? 3);
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
  const [showRooftopLayer, setShowRooftopLayer] = useState(() => urlInitialState.showRooftopLayer ?? false);
  // Observer restore only makes sense when the URL also carried a launch
  // point — a lone `?observer=` would open the profile panel pointing at a
  // launch that isn't there. The launch-effect guard below already re-checks,
  // but null-ing here keeps the initial render honest too.
  const [observer, setObserver] = useState(() =>
    urlInitialState.launch && urlInitialState.observer ? urlInitialState.observer : null
  );
  const markerRef = useRef(null);
  const observerMarkerRef = useRef(null);
  const placingRef = useRef(placing);
  const placingObserverRef = useRef(placingObserver);
  const workerRef = useRef(null);
  const hiddenSourceRef = useRef(null);
  // Latest terrain grid — loaded when a launch point is set, passed to
  // the worker (for grid+rooftop compute) and to computeSightlineProfile
  // (for the observer-picked profile). Null when no launch yet, no
  // terrain available, or the fetch failed — all treated as flat ground
  // by the downstream compute functions (see 地形高程集成_实施方案.md §9.2
  // — graceful downgrade path).
  const elevationGridRef = useRef(null);
  // Firework-animation trigger. Bumped once when a launch point is placed
  // (initial or via URL restore) so the animation plays on first render,
  // and again whenever the user hits "Play again." A monotonic counter
  // rather than a boolean because that's what makes the "same launch
  // point, replay" case a state change (a boolean toggle would need two
  // clicks to fire twice).
  const [fireworkPlayCount, setFireworkPlayCount] = useState(0);
  const lastPlayedFor = useRef(null);
  // Top recommended viewing spots, derived from the ground grid once the
  // worker returns — see pickTopSpots.js. Small array of {rank, score,
  // lat, lng}; markers are managed by a separate effect below.
  const [topSpots, setTopSpots] = useState([]);
  const topSpotMarkersRef = useRef([]);
  // Flipped once the setup effect below has added VANTAGE's own source and
  // layer to the map. The grid/profile effects gate on it so a URL-restored
  // launch point (which sits in state before the map's style has finished
  // loading, unlike a click-placed one) will still compute — otherwise the
  // grid effect would early-return on the missing source and never re-run.
  const [sourcesRegistered, setSourcesRegistered] = useState(false);
  // Bumped on every grid request so a response that arrives after a newer
  // request was already sent (rapid caliber drags, mainly) gets ignored
  // instead of overwriting the map with stale data — see the grid effect
  // below for how this is used.
  const requestIdRef = useRef(0);

  useEffect(() => {
    placingRef.current = placing;
  }, [placing]);
  useEffect(() => {
    placingObserverRef.current = placingObserver;
  }, [placingObserver]);

  // viewerLevel lives in LaunchProvider's context state (ProfilePanel writes
  // to it), so unlike launch/caliber/etc. we can't seed it via useState. Push
  // it in once on mount if the URL had one, and only if it's meaningful — a
  // level without an observer point has nothing to attach to.
  useEffect(() => {
    if (!setViewerLevel) return;
    if (urlInitialState.launch && urlInitialState.observer && urlInitialState.viewerLevel) {
      setViewerLevel(urlInitialState.viewerLevel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror the current analysis state back to URL query params so a copied
  // link restores it. Guarded against writing the same string every render
  // (the browser rate-limits history.replaceState per app/map/page.jsx:121).
  // Map camera state stays in the URL fragment via maplibre's own hash:true;
  // that hash and these params live on opposite sides of the "?" / "#" split
  // so the two writers don't interact.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const currentSearch = window.location.search.startsWith("?")
      ? window.location.search.slice(1)
      : window.location.search;
    const nextSearch = writeLaunchUrlState(currentSearch, {
      launch,
      caliber,
      observer,
      viewerLevel: contextViewerLevel,
      showRooftopLayer,
      presetId: selectedPresetId,
      // getPinnedReleaseId is a sync read of whatever release the STAC
      // pipeline landed on (null before it loads) — snapshotting it into
      // the URL lets a report receiver know which Overture release
      // produced the numbers, even though the URL alone can't yet force
      // a rebind on a fresh open.
      stacRelease: getPinnedReleaseId() ?? undefined,
    });
    if (nextSearch === currentSearch) return;
    const url = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", url);
  }, [launch, caliber, observer, contextViewerLevel, showRooftopLayer, selectedPresetId]);

  // Publish "does VANTAGE want to keep this click for itself?" through the
  // launch context so MapView.jsx's own click handler can early-return
  // instead of also opening feature-inspect on whatever building sat under
  // the click — see lib/launchClickCapture.js for the predicate itself and
  // components/launch/LaunchProvider.jsx for why the ref lives there.
  useEffect(() => {
    if (!setClickCapturePredicate) return;
    setClickCapturePredicate((clickLngLat) =>
      isVantageClick({ placing, placingObserver, launch, clickLngLat })
    );
    return () => setClickCapturePredicate(null);
  }, [setClickCapturePredicate, placing, placingObserver, launch]);

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

  // Buildings for the viewshed math come from a hidden second map (see
  // lib/HiddenBuildingSource.js), not map.querySourceFeatures() on the
  // visible one — the visible map only has tiles loaded for whatever's
  // currently on screen, which silently clipped the rooftop-view overlay to
  // the loaded-viewport boundary instead of the full ANALYSIS_RADIUS
  // circle. Created lazily (first use, see getHiddenSource below) since the
  // visible map's "buildings" source url isn't available until its own
  // sources have loaded; torn down whenever `map` changes/unmounts.
  useEffect(() => {
    return () => {
      if (hiddenSourceRef.current) {
        hiddenSourceRef.current.destroy();
        hiddenSourceRef.current = null;
      }
    };
  }, [map]);

  // Selecting a preset fires the launch at its coordinates + caliber, kills
  // any in-flight placing mode, plays the celebratory firework animation,
  // and flies the map to the show's location. It intentionally leaves the
  // observer alone — pick-a-real-show is about seeing the launch on the
  // map, then the user decides where they'd watch from.
  const applyPreset = useCallback((preset) => {
    setPresetMenuAnchor(null);
    setLaunch({ lat: preset.lat, lng: preset.lng });
    setCaliber(preset.caliber);
    setPlacing(false);
    setPlacingObserver(false);
    setObserver(null);
    setSelectedPresetId(preset.id);
    setFireworkPlayCount((n) => n + 1);
    if (map) {
      map.flyTo({
        center: [preset.lng, preset.lat],
        zoom: preset.zoom ?? 14,
        speed: 1.6,
      });
    }
  }, [map]);

  const getHiddenSource = useCallback(() => {
    if (!map) return null;
    if (!hiddenSourceRef.current) {
      // map.getStyle() can be undefined before the style has loaded — the URL-
      // restore path hits this before mapLoaded, since launch state seeds from
      // the URL synchronously and the profile effect fires as soon as launch
      // and observer both exist, well before the "buildings" source has been
      // added by MapView's own load-driven addSources() effect.
      const buildingsSource = map.getStyle()?.sources?.buildings;
      if (!buildingsSource?.url) return null;
      hiddenSourceRef.current = createHiddenBuildingSource(buildingsSource.url);
    }
    return hiddenSourceRef.current;
  }, [map]);

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
      // fill-extrusion (not fill) so the colored cap actually renders at
      // roof height rather than painting flat on the ground plane under a
      // pitched camera — base/height both read buildingHeight (set by
      // computeRooftopLayer.js), with a 1m gap between them so the cap has
      // nonzero thickness to shade.
      map.addLayer({
        id: ROOFTOP_LAYER_ID,
        type: "fill-extrusion",
        source: ROOFTOP_SOURCE_ID,
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": [
            "match", ["get", "category"],
            "blocked", "#d32f2f",
            "poor-angle", "#7e57c2",
            "partial", "#fbc02d",
            "good", "#2e7d32",
            // Large buildings (lib/viewshed/computeRooftopLayer.js) where a
            // few extra corner samples disagreed with the centroid on
            // blocked-vs-not, so no single verdict is trustworthy for the
            // whole roof. Grey reads as "uncertain," deliberately off the
            // red/purple/yellow/green spectrum the other four use.
            "mixed", "#9e9e9e",
            "#9e9e9e",
          ],
          "fill-extrusion-base": ["get", "buildingHeight"],
          "fill-extrusion-height": ["+", ["get", "buildingHeight"], 1],
          "fill-extrusion-opacity": 0.85,
        },
      });

      if (!map.getSource(SIGHTLINE_SOURCE_ID)) {
        map.addSource(SIGHTLINE_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: SIGHTLINE_LAYER_ID,
          type: "line",
          source: SIGHTLINE_SOURCE_ID,
          paint: {
            "line-color": [
              "match", ["get", "segment"],
              "blocked", "#d32f2f",
              "#2e7d32",
            ],
            "line-width": 3,
            "line-opacity": 0.9,
          },
        });
      }
      if (!map.getSource(BLOCKER_SOURCE_ID)) {
        map.addSource(BLOCKER_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: BLOCKER_LAYER_ID,
          type: "line",
          source: BLOCKER_SOURCE_ID,
          paint: {
            "line-color": "#d32f2f",
            "line-width": 3,
            "line-opacity": 0.95,
          },
        });
      }
      setSourcesRegistered(true);
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

  // Click-to-place — a separate listener from MapView's own click handler.
  // MapView's handler defers to launchAnalysis.clickCaptureRef (published
  // above) and early-returns for these clicks, so placing no longer also
  // pops the feature-inspect panel on whatever building sat under the click.
  useEffect(() => {
    if (!map) return;
    const onClick = (e) => {
      if (!placingRef.current) return;
      setLaunch({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      setObserver(null); // stale profile pointed at the old launch location
      // Manual placement invalidates any preset-id lineage — the launch is
      // no longer at Macy's coords, so leaving `?preset=nyc-macys` in the
      // URL would be a lie.
      setSelectedPresetId(null);
      setPlacing(false);
    };
    map.on("click", onClick);
    return () => map.off("click", onClick);
  }, [map]);

  // Click-to-pick an observer point for the profile view. Dedicated mode
  // (placingObserver) rather than "any click inside the heat-map circle" —
  // far observers live outside that circle, and unbounded click-capture
  // would steal MapView's feature-inspect. Uses the exact clicked lat/lng.
  useEffect(() => {
    if (!map || !launch) return;
    const onClick = (e) => {
      if (placingRef.current) return;
      if (!placingObserverRef.current) return;
      setObserver({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      setPlacingObserver(false);
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

  // Auto-play the firework the first time each new launch point appears
  // (both fresh clicks and URL restores). A ref keyed by the launch
  // point's coord string, not just presence, so replacing the launch
  // point with a new one plays again, and re-render churn on the same
  // launch doesn't retrigger.
  useEffect(() => {
    if (!launch) {
      lastPlayedFor.current = null;
      return;
    }
    const key = `${launch.lat},${launch.lng}`;
    if (lastPlayedFor.current === key) return;
    lastPlayedFor.current = key;
    setFireworkPlayCount((n) => n + 1);
  }, [launch]);

  // Firework animation. Mounts a marker whose element runs the rise +
  // flash + particle-burst + smoke keyframes above, then removes itself
  // after ~2.7s (rise 700ms + burst 1600ms + smoke tail + a small buffer).
  // Purely decorative — does not touch analysis state, and the marker is
  // separate from the permanent launch-point marker (`markerRef`), so
  // both can render at the same lat/lng together. New palette + jittered
  // particle angles/hues on every play so consecutive fireworks don't
  // look identical.
  useEffect(() => {
    if (!map || !launch || fireworkPlayCount === 0) return;
    const el = document.createElement("div");
    el.innerHTML = buildFireworkHtml();
    el.style.cssText = "position:relative; width:0; height:0; pointer-events:none; z-index:5;";
    const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
      .setLngLat([launch.lng, launch.lat])
      .addTo(map);
    const timeoutId = setTimeout(() => marker.remove(), 2800);
    return () => {
      clearTimeout(timeoutId);
      marker.remove();
    };
  }, [map, launch, fireworkPlayCount]);

  // Numbered markers for the top recommended viewing spots. Separate
  // effect from the animation so the two lifecycles don't fight — top
  // spots persist until the next analysis or clear, animations are
  // one-shot.
  useEffect(() => {
    if (!map) return;
    for (const marker of topSpotMarkersRef.current) marker.remove();
    topSpotMarkersRef.current = [];
    for (const spot of topSpots) {
      const el = document.createElement("div");
      el.textContent = String(spot.rank);
      el.style.cssText =
        "width:24px;height:24px;border-radius:50%;background:#2e7d32;color:white;" +
        "display:flex;align-items:center;justify-content:center;font-weight:700;" +
        "font-size:12px;box-shadow:0 2px 4px rgba(0,0,0,0.35);border:2px solid white;";
      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([spot.lng, spot.lat])
        .addTo(map);
      topSpotMarkersRef.current.push(marker);
    }
    return () => {
      for (const marker of topSpotMarkersRef.current) marker.remove();
      topSpotMarkersRef.current = [];
    };
  }, [map, topSpots]);

  useEffect(() => {
    if (!map || !map.getSource(SOURCE_ID)) return;
    // MapView adds its own ~100 layers asynchronously as PMTiles sources load,
    // which can land after this component's own setup effect and bury the
    // fill layer underneath all of them. Bump it back to the top whenever
    // the user actually interacts, rather than fighting that load order.
    if (map.getLayer(LAYER_ID)) map.moveLayer(LAYER_ID);
    if (map.getLayer(ROOFTOP_LAYER_ID)) map.moveLayer(ROOFTOP_LAYER_ID);
    if (map.getLayer(SIGHTLINE_LAYER_ID)) map.moveLayer(SIGHTLINE_LAYER_ID);
    if (map.getLayer(BLOCKER_LAYER_ID)) map.moveLayer(BLOCKER_LAYER_ID);

    if (!launch) {
      map.getSource(SOURCE_ID).setData({ type: "FeatureCollection", features: [] });
      if (map.getSource(ROOFTOP_SOURCE_ID)) {
        map.getSource(ROOFTOP_SOURCE_ID).setData({ type: "FeatureCollection", features: [] });
      }
      setRooftopBase(0);
      setTopSpots([]);
      return;
    }

    const worker = workerRef.current;
    const hiddenSource = getHiddenSource();
    if (!worker || !hiddenSource) return;

    let cancelled = false;
    const requestId = ++requestIdRef.current;
    const queryStart = performance.now();

    // Kick off building query and terrain fetch in parallel — both are
    // network-bound, no ordering constraint between them. loadElevation-
    // GridForBounds is browser-only (fetch + createImageBitmap +
    // OffscreenCanvas per ElevationGrid.js) but this whole effect only
    // runs client-side. Bbox is the axis-aligned square inscribing the
    // 1500m analysis circle (slight overload vs. tight circle, but
    // simpler and terrain data is small enough that it doesn't matter).
    const terrainProjector = makeLocalProjector(launch.lat, launch.lng);
    const ne = terrainProjector.toLatLng(ANALYSIS_RADIUS, ANALYSIS_RADIUS);
    const sw = terrainProjector.toLatLng(-ANALYSIS_RADIUS, -ANALYSIS_RADIUS);
    const terrainPromise = loadElevationGridForBounds({
      westLng: sw.lng,
      southLat: sw.lat,
      eastLng: ne.lng,
      northLat: ne.lat,
    }).catch((err) => {
      // Failure downgrade path per 实施方案.md §9.2 — surface via console
      // and continue with null so the analysis still produces a result
      // (flat-ground fallback). Loud fail here would leave the user with
      // no output at all.
      console.warn("terrain load failed, falling back to flat ground:", err);
      return null;
    });

    Promise.all([
      hiddenSource.query(launch, ANALYSIS_RADIUS),
      terrainPromise,
    ]).then(([{ buildingFeats, partFeats }, terrainGrid]) => {
      if (cancelled || requestId !== requestIdRef.current) return; // superseded by a newer request
      elevationGridRef.current = terrainGrid;
      const allBuildings = buildingsFromMapFeatures(buildingFeats, partFeats);
      // Nothing farther than the analysis radius from the launch point can
      // ever sit on a sightline the grid tests — cutting them here shrinks the
      // O(cells x buildings) cost itself, not just where it runs.
      const buildings = filterBuildingsNearPoint(allBuildings, launch, ANALYSIS_RADIUS);
      const queryMs = performance.now() - queryStart;

      // Computed fresh here (not read from the `rooftopBase` state var) so the
      // request below always uses the value that matches the buildings just
      // queried — the state update is for display purposes (the caption below)
      // and only takes effect on the next render.
      const rooftop = findRooftopBase(launch, buildings);
      setRooftopBase(rooftop);

      // Serialize terrainGrid for postMessage — structuredClone preserves
      // the TypedArray buffer but not class methods, so send the plain
      // shape and rebuild the class on the worker side (see worker.js).
      const terrainPayload = terrainGrid
        ? {
            buffer: terrainGrid.data.buffer,
            cellsX: terrainGrid.cellsX,
            cellsY: terrainGrid.cellsY,
            northLat: terrainGrid.northLat,
            westLng: terrainGrid.westLng,
            latStepDeg: terrainGrid.latStepDeg,
            lngStepDeg: terrainGrid.lngStepDeg,
          }
        : null;

      const computeStart = performance.now();
      worker.addEventListener(
        "message",
        (e) => {
          if (requestId !== requestIdRef.current) return; // superseded by a newer request
          if (e.data.error) {
            // Worker-side exception surfaced via message payload (worker
            // exceptions don't propagate as pageerror). Log loud and skip
            // the render step; the grid stays empty rather than being
            // updated with garbage.
            console.error("viewshed worker error:", e.data.error);
            return;
          }
          const computeMs = performance.now() - computeStart;
          const { grid, rooftop: rooftopLayer } = e.data;
          map.getSource(SOURCE_ID).setData(grid);
          if (map.getSource(ROOFTOP_SOURCE_ID)) map.getSource(ROOFTOP_SOURCE_ID).setData(rooftopLayer);
          setTopSpots(pickTopSpots(grid.features));
          reportViewshedPerf({
            queryMs,
            computeMs,
            buildingCount: buildings.length,
            cellCount: grid.features.length,
            rooftopCount: rooftopLayer.features.length,
            avgCandidates: grid.avgCandidates,
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
        terrainGrid: terrainPayload,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [map, launch, caliberHeight, shellRadius, getHiddenSource, sourcesRegistered]);

  // Full sightline breakdown for whichever point the user picked, published
  // to LaunchContext so ProfilePanel (mounted in the bottom ProfileDock)
  // can render it. Inside the heat-map radius this still uses the hidden
  // MapLibre source (already loaded for the grid). Outside it, a z14 PMTiles
  // corridor walk fetches only the tiles the observer→launch line crosses —
  // HiddenBuildingSource.fitBounds of a 20km bbox would zoom out past
  // building tiles and silently report "nothing in the way."
  useEffect(() => {
    if (!setAnalysis) return;
    const emptyLines = { type: "FeatureCollection", features: [] };
    const paintSightline = (obs, profile) => {
      if (!map) return;
      const { lines, blocker } = sightlineMapData({ observer: obs, launch, profile });
      if (map.getSource(SIGHTLINE_SOURCE_ID)) map.getSource(SIGHTLINE_SOURCE_ID).setData(lines);
      if (map.getSource(BLOCKER_SOURCE_ID)) map.getSource(BLOCKER_SOURCE_ID).setData(blocker);
    };

    if (!launch) {
      setAnalysis(null);
      paintSightline(null, null);
      return;
    }
    if (!map || !observer) {
      setAnalysis({ launch, targetHeight, shellRadius, caliber, observer: null, observerBuilding: null, profile: null });
      paintSightline(null, null);
      return;
    }

    const projector = makeLocalProjector(launch.lat, launch.lng);
    const { x, y } = projector.toLocal(observer.lat, observer.lng);
    const distance = Math.hypot(x, y);
    const useCorridor = distance > ANALYSIS_RADIUS;

    const finish = (buildings, terrainGrid, coverageGaps, mode) => {
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
        terrainGrid,
        coverageGaps,
      });

      const observerBuilding = building ? { ...building, maxFloors } : null;
      // mode/buildingsConsidered/*Meters exist purely so ProfilePanel's debug-
      // log button (lib/viewshed/debugReport.js) can explain which fetch path
      // ran and how many buildings it fed into the intersection test — not
      // consumed by the visibility math itself.
      setAnalysis({
        launch, targetHeight, shellRadius, caliber, observer, observerBuilding, profile,
        mode, buildingsConsidered: buildings.length,
        analysisRadiusMeters: ANALYSIS_RADIUS, corridorBufferMeters: CORRIDOR_BUFFER_METERS,
      });
      paintSightline(observer, profile);
    };

    let cancelled = false;

    if (!useCorridor) {
      const hiddenSource = getHiddenSource();
      if (!hiddenSource) return;
      hiddenSource.query(launch, ANALYSIS_RADIUS).then(({ buildingFeats, partFeats }) => {
        if (cancelled) return;
        const allBuildings = buildingsFromMapFeatures(buildingFeats, partFeats);
        const buildings = filterBuildingsNearPoint(allBuildings, launch, ANALYSIS_RADIUS);
        finish(buildings, elevationGridRef.current, [], "grid");
      });
      return () => { cancelled = true; };
    }

    const buildingsUrl = map.getStyle()?.sources?.buildings?.url;
    if (!buildingsUrl) return;

    setAnalysis((prev) => ({
      launch, targetHeight, shellRadius, caliber, observer,
      observerBuilding: prev?.observerBuilding ?? null,
      profile: prev?.profile ?? null,
      loading: true,
    }));

    Promise.all([
      loadBuildingsAlongCorridor({
        pmtilesUrl: buildingsUrl,
        from: observer,
        to: launch,
        bufferMeters: CORRIDOR_BUFFER_METERS,
      }),
      loadElevationGridForCorridor({
        from: observer,
        to: launch,
        bufferMeters: CORRIDOR_BUFFER_METERS,
      }).catch((err) => {
        console.warn("corridor terrain load failed:", err);
        return { grid: null, missingTiles: [] };
      }),
    ]).then(([{ buildings, coverageGaps }, { grid, missingTiles }]) => {
      if (cancelled) return;
      const terrainGaps = [];
      for (const tile of missingTiles) {
        const span = tileDistanceSpan(tile, observer, launch, TERRAIN_TILE_ZOOM);
        if (span) terrainGaps.push({ ...span, source: "terrain" });
      }
      finish(buildings, grid, [...coverageGaps, ...terrainGaps], "corridor");
    }).catch((err) => {
      if (cancelled) return;
      console.error("corridor sightline fetch failed:", err);
      setAnalysis({
        launch, targetHeight, shellRadius, caliber, observer,
        observerBuilding: null, profile: null, loading: false, fetchError: true,
      });
    });

    return () => { cancelled = true; };
  }, [map, launch, observer, targetHeight, shellRadius, caliber, viewerLevel, setAnalysis, getHiddenSource]);

  return (
    <>
    <style dangerouslySetInnerHTML={{ __html: FIREWORK_CSS }} />
    <Paper
      elevation={4}
      sx={{
        position: "fixed",
        // Top-left, below the 60px header. Was left:50% + translateX(-50%),
        // which put the panel dead-center on top of the launch pin the
        // user had just placed near the middle of the map. Bottom-left is
        // taken by the star bookmark dial (BookmarkDial, also left: 24),
        // and top-right by the zoom/geolocate/terrain map controls, so
        // top-left is the only conflict-free corner.
        top: 84,
        left: 24,
        zIndex: 1200,
        p: 2,
        width: 300,
        // Prevent the panel outgrowing the viewport when both the header
        // (60px) and the bottom dock (up to ~292px) are on screen — its
        // internal Stack scrolls in the rare case that overflows.
        maxHeight: "calc(100vh - 60px - var(--vantage-profile-dock-height, 0px) - 48px)",
        overflow: "auto",
      }}
    >
      <Stack spacing={1.5}>
        <Button variant={placing ? "contained" : "outlined"} onClick={() => {
          setPlacing((p) => !p);
          setPlacingObserver(false);
        }}>
          {placing ? "Click the map to place…" : launch ? "Move launch point" : "Set launch point"}
        </Button>
        <Button
          size="small"
          variant="text"
          onClick={(e) => setPresetMenuAnchor(e.currentTarget)}
          endIcon={<Box component="span" sx={{ fontSize: 11 }}>▾</Box>}
          sx={{ textTransform: "none", justifyContent: "center", color: "text.secondary", py: 0.25 }}
        >
          🎆 Or load a real show
        </Button>
        <Menu
          anchorEl={presetMenuAnchor}
          open={Boolean(presetMenuAnchor)}
          onClose={() => setPresetMenuAnchor(null)}
          slotProps={{ paper: { sx: { maxHeight: 420, width: 300 } } }}
        >
          {FIREWORKS_PRESETS.map((preset) => (
            <MenuItem
              key={preset.id}
              onClick={() => applyPreset(preset)}
              sx={{ py: 1, alignItems: "flex-start" }}
            >
              <Stack sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {preset.name}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {preset.city} · {preset.caliber}&quot; shells
                </Typography>
              </Stack>
            </MenuItem>
          ))}
        </Menu>
        {!launch && (
          // Empty-state hint. The landing page (app/page.jsx) explains the
          // app once; once the user's on the map, the button label alone
          // uses jargon ("launch point") without saying what the app does —
          // this one line closes that gap without hijacking the panel.
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            Click the button, then click a spot on the map to see where the fireworks would be visible within a {ANALYSIS_RADIUS / 1000} km radius.
          </Typography>
        )}
        {launch && (
          <>
            {/* Post-placement hint. ProfilePanel (mounted in ProfileDock)
                is fully wired to render for any observer point, but nothing
                else in the map UI signals that clicking a spot opens it —
                users would have to accidentally discover it. Same shape as
                the empty-state hint above. */}
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {placingObserver
                ? "Click anywhere on the map to check visibility from that spot."
                : "Place a viewing spot — inside the circle or kilometers away."}
            </Typography>
            <Button
              variant={placingObserver ? "contained" : "outlined"}
              size="small"
              onClick={() => {
                setPlacingObserver((p) => !p);
                setPlacing(false);
              }}
            >
              {placingObserver ? "Click the map…" : observer ? "Move viewing spot" : "Check a viewing spot"}
            </Button>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
              <Typography variant="caption">
                Caliber: {caliber}&quot; · burst ~{Math.round(targetHeight)}m
                {rooftopBase > 0 && ` (incl. ${Math.round(rooftopBase)}m rooftop)`}
                {" "}· shell ~{Math.round(shellRadius)}m
              </Typography>
              <Button
                size="small"
                sx={{ minWidth: 0, px: 0.5, fontSize: 11, textTransform: "none", flexShrink: 0 }}
                onClick={() => setFireworkPlayCount((n) => n + 1)}
                aria-label="Play firework animation again"
              >
                🎆 Play
              </Button>
            </Stack>
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
            <Stack spacing={0.5}>
              {LEGEND_ENTRIES.map((entry) => (
                <LegendRow key={entry.color} color={entry.color} label={entry.label} />
              ))}
              {showRooftopLayer && (
                <LegendRow color={ROOFTOP_LEGEND_EXTRA.color} label={ROOFTOP_LEGEND_EXTRA.label} />
              )}
            </Stack>
            {/* Coverage caveat — analysis now factors in buildings AND
                terrain (see 地形高程集成_实施方案.md phases 1-5); still
                missing: trees and weather. Kept the disclaimer so users
                who see the tool succeed at Twin Peaks don't overtrust it
                at Central Park's tree-lined edges. */}
            <Typography variant="caption" sx={{ color: "text.secondary", fontStyle: "italic" }}>
              Analysis considers buildings and terrain — trees and weather aren&apos;t factored in.
            </Typography>
            <Button
              size="small"
              onClick={() => {
                setLaunch(null);
                setObserver(null);
                setSelectedPresetId(null);
              }}
            >
              Clear
            </Button>
          </>
        )}
      </Stack>
    </Paper>
    </>
  );
}

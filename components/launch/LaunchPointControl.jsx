"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { Paper, Button, Typography, Slider, Stack } from "@mui/material";
import { useMapInstance } from "@/lib/MapContext";
import { useLaunchAnalysis } from "@/lib/LaunchContext";
import { makeLocalProjector } from "@/lib/geo/toLocalMeters";
import { buildingsFromMapFeatures } from "@/lib/geo/overtureBuildingAdapter";
import { computeViewshed } from "@/lib/viewshed/computeViewshed";
import { computeSightlineProfile } from "@/lib/viewshed/computeProfile";

const ANALYSIS_RADIUS = 300;
const RADIAL_SPACING = 20; // meters between rings
const ANGULAR_SPACING = 6; // degrees between sectors — 60 sectors per ring
const SOURCE_ID = "vantage-viewshed";
const LAYER_ID = "vantage-viewshed-sectors";

export default function LaunchPointControl() {
  const map = useMapInstance();
  const setAnalysis = useLaunchAnalysis()?.setAnalysis;
  const [placing, setPlacing] = useState(false);
  const [launch, setLaunch] = useState(null);
  const [height, setHeight] = useState(100);
  const [shellRadius, setShellRadius] = useState(20);
  const [observer, setObserver] = useState(null);
  const markerRef = useRef(null);
  const placingRef = useRef(placing);

  useEffect(() => {
    placingRef.current = placing;
  }, [placing]);

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
          "fill-color": [
            "interpolate", ["linear"], ["get", "frac"],
            0, "#d32f2f",
            0.5, "#fbc02d",
            1, "#2e7d32",
          ],
          "fill-opacity": 0.55,
          "fill-outline-color": "rgba(0,0,0,0.15)",
        },
      });
    };
    if (map.isStyleLoaded()) setup();
    else map.once("idle", setup);
  }, [map]);

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
    };
    map.on("click", onClick);
    return () => map.off("click", onClick);
  }, [map, launch]);

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

  useEffect(() => {
    if (!map || !map.getSource(SOURCE_ID)) return;
    // MapView adds its own ~100 layers asynchronously as PMTiles sources load,
    // which can land after this component's own setup effect and bury the
    // fill layer underneath all of them. Bump it back to the top whenever
    // the user actually interacts, rather than fighting that load order.
    if (map.getLayer(LAYER_ID)) map.moveLayer(LAYER_ID);

    if (!launch) {
      map.getSource(SOURCE_ID).setData({ type: "FeatureCollection", features: [] });
      return;
    }

    const buildingFeats = map.querySourceFeatures("buildings", { sourceLayer: "building" });
    const partFeats = map.querySourceFeatures("buildings", { sourceLayer: "building_part" });
    const buildings = buildingsFromMapFeatures(buildingFeats, partFeats);

    const result = computeViewshed({
      launch,
      targetHeight: height,
      shellRadius,
      analysisRadius: ANALYSIS_RADIUS,
      radialSpacing: RADIAL_SPACING,
      angularSpacing: ANGULAR_SPACING,
      buildings,
    });

    map.getSource(SOURCE_ID).setData(result);
  }, [map, launch, height, shellRadius]);

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
      setAnalysis({ launch, height, shellRadius, observer: null, profile: null });
      return;
    }

    const buildingFeats = map.querySourceFeatures("buildings", { sourceLayer: "building" });
    const partFeats = map.querySourceFeatures("buildings", { sourceLayer: "building_part" });
    const buildings = buildingsFromMapFeatures(buildingFeats, partFeats);

    const profile = computeSightlineProfile({
      observer,
      launch,
      targetHeight: height,
      shellRadius,
      buildings,
    });

    setAnalysis({ launch, height, shellRadius, observer, profile });
  }, [map, launch, observer, height, shellRadius, setAnalysis]);

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
            <Typography variant="caption">Launch height: {height}m</Typography>
            <Slider min={10} max={400} value={height} onChangeCommitted={(_, v) => setHeight(v)} />
            <Typography variant="caption">Shell radius: {shellRadius}m</Typography>
            <Slider min={5} max={80} value={shellRadius} onChangeCommitted={(_, v) => setShellRadius(v)} />
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

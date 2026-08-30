"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { Paper, Button, Typography, Slider, Stack } from "@mui/material";
import { useMapInstance } from "@/lib/MapContext";
import { buildingsFromMapFeatures } from "@/lib/geo/overtureBuildingAdapter";
import { computeViewshed } from "@/lib/viewshed/computeViewshed";

const ANALYSIS_RADIUS = 300;
const GRID_SPACING = 15;
const SOURCE_ID = "vantage-viewshed";
const LAYER_ID = "vantage-viewshed-points";

export default function LaunchPointControl() {
  const map = useMapInstance();
  const [placing, setPlacing] = useState(false);
  const [launch, setLaunch] = useState(null);
  const [height, setHeight] = useState(100);
  const [shellRadius, setShellRadius] = useState(20);
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
      map.addLayer({
        id: LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": 5,
          "circle-color": [
            "interpolate", ["linear"], ["get", "frac"],
            0, "#d32f2f",
            0.5, "#fbc02d",
            1, "#2e7d32",
          ],
          "circle-opacity": 0.85,
          "circle-stroke-width": 1,
          "circle-stroke-color": "rgba(0,0,0,0.4)",
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
      setPlacing(false);
    };
    map.on("click", onClick);
    return () => map.off("click", onClick);
  }, [map]);

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
    // circle layer underneath all of them. Bump it back to the top whenever
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
      gridSpacing: GRID_SPACING,
      buildings,
    });

    map.getSource(SOURCE_ID).setData(result);
  }, [map, launch, height, shellRadius]);

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
            <Button size="small" onClick={() => setLaunch(null)}>Clear</Button>
          </>
        )}
      </Stack>
    </Paper>
  );
}

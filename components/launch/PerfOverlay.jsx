"use client";

import { useEffect, useState } from "react";
import { Box, Stack, Typography } from "@mui/material";
import { onViewshedPerf } from "@/lib/perf";

// FPS sampled over a rolling ~500ms window via rAF — a rough but honest
// "is the main thread keeping up" signal, independent of whatever
// LaunchPointControl reports below. That report only covers the viewshed
// query+compute cost; this catches jank from anything else running at the
// same time (e.g. the mousemove hit-testing / dual explore-inspect maps
// flagged in todo.md's "地图页卡顿" section — this HUD doesn't measure those
// directly, but a low FPS with a small viewshed number below points at them).
function useFps() {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let frames = 0;
    let windowStart = performance.now();
    let raf;
    const tick = (now) => {
      frames++;
      const elapsed = now - windowStart;
      if (elapsed >= 500) {
        setFps(Math.round((frames * 1000) / elapsed));
        frames = 0;
        windowStart = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return fps;
}

function fpsColor(fps) {
  if (fps === 0) return "#888";
  if (fps < 30) return "#ff5252";
  if (fps < 50) return "#ffca28";
  return "#69f0ae";
}

// Dev-only diagnostic overlay — not a product surface. Mounted conditionally
// in app/map/page.jsx so `process.env.NODE_ENV === "production"` dead-code-
// eliminates it (and this whole module) out of the shipped static export.
export default function PerfOverlay() {
  const fps = useFps();
  const [viewshed, setViewshed] = useState(null);

  useEffect(() => onViewshedPerf(setViewshed), []);

  return (
    <Box
      sx={{
        position: "fixed",
        bottom: 8,
        right: 8,
        zIndex: 2000,
        bgcolor: "rgba(0,0,0,0.78)",
        color: "#e0e0e0",
        fontFamily: "monospace",
        fontSize: 11,
        lineHeight: 1.6,
        p: 1,
        borderRadius: 1,
        pointerEvents: "none",
        minWidth: 190,
      }}
    >
      <Stack direction="row" spacing={1} alignItems="baseline">
        <Box component="span" sx={{ color: "#fff", fontWeight: 700 }}>FPS</Box>
        <Box component="span" sx={{ color: fpsColor(fps) }}>{fps || "…"}</Box>
      </Stack>
      {viewshed ? (
        <>
          <Box>query: {viewshed.queryMs.toFixed(0)}ms ({viewshed.buildingCount} bldgs)</Box>
          <Box>compute: {viewshed.computeMs.toFixed(0)}ms ({viewshed.cellCount} cells)</Box>
          <Box sx={{ color: "#fff" }}>total: {(viewshed.queryMs + viewshed.computeMs).toFixed(0)}ms</Box>
        </>
      ) : (
        <Typography sx={{ fontFamily: "inherit", fontSize: "inherit", color: "#aaa" }}>
          place a launch point to see viewshed timing
        </Typography>
      )}
    </Box>
  );
}

"use client";

import { useLayoutEffect, useEffect } from "react";
import PropTypes from "prop-types";
import { Paper } from "@mui/material";
import ProfilePanel from "@/components/analysis/ProfilePanel";
import { useLaunchAnalysis } from "@/lib/LaunchContext";
import {
  PROFILE_DOCK_HEIGHT_VAR,
  dockHeightPx,
} from "@/components/analysis/profileDockMetrics";

export { PROFILE_DOCK_HEIGHT_VAR } from "@/components/analysis/profileDockMetrics";

export default function ProfileDock({ isDark }) {
  const { analysis } = useLaunchAnalysis() ?? {};
  const height = dockHeightPx(analysis);

  useLayoutEffect(() => {
    document.documentElement.style.setProperty(PROFILE_DOCK_HEIGHT_VAR, `${height}px`);
  }, [height]);

  useEffect(() => () => {
    document.documentElement.style.setProperty(PROFILE_DOCK_HEIGHT_VAR, "0px");
  }, []);

  // Nothing to show yet (no launch, or a launch with no viewing spot picked
  // and no in-flight analysis) — skip the Paper altogether so it doesn't
  // paint a hairline against the map for no reason.
  if (!analysis) return null;
  if (height === 0) return null;

  return (
    <Paper
      elevation={0}
      square
      sx={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1100,
        height,
        overflow: "hidden",
        bgcolor: isDark ? "#121212" : "#fff",
        color: isDark ? "#fff" : "#000",
        borderTop: isDark
          ? "1px solid rgba(255,255,255,0.12)"
          : "1px solid rgba(0,0,0,0.12)",
      }}
    >
      <ProfilePanel isDark={isDark} layout="dock" />
    </Paper>
  );
}

ProfileDock.propTypes = {
  isDark: PropTypes.bool,
};

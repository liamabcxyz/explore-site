import PropTypes from "prop-types";
import { useLayoutEffect, useRef, useState } from "react";
import { Box, Typography, Stack, ToggleButton, ToggleButtonGroup, Slider } from "@mui/material";
import { useLaunchAnalysis } from "@/lib/LaunchContext";
import { EYE_HEIGHT } from "@/lib/viewshed/scoring";
import { apparentAltitude } from "@/lib/viewshed/curvature";
import { PROFILE_DOCK_CHART_PX, PROFILE_DOCK_HEADER_PX, PROFILE_DOCK_PROMPT_PX } from "@/components/analysis/profileDockMetrics";

// Same red/yellow/green the map's own viewshed grid dots use (see the
// circle-color paint expression in components/launch/LaunchPointControl.jsx)
// — keeping one visual language for "how visible is this point" across the
// map and the panel, rather than introducing a second palette for the same
// concept.
const BLOCKED_COLOR = "#d32f2f";
const PARTIAL_COLOR = "#fbc02d";
const VISIBLE_COLOR = "#2e7d32";
// Matches the "poor-angle" fill-color in LaunchPointControl.jsx's viewshed
// layer — deliberately not on the red-yellow-green line-of-sight scale,
// since "clear view, bad angle" is a different problem from "blocked."
const POOR_ANGLE_COLOR = "#7e57c2";

function verdictColor(frac) {
  if (frac >= 0.66) return VISIBLE_COLOR;
  if (frac >= 0.33) return PARTIAL_COLOR;
  return BLOCKED_COLOR;
}

function verdictLabel(frac) {
  if (frac >= 0.66) return "Visible";
  if (frac >= 0.33) return "Partially blocked";
  return "Blocked";
}

// For the composite score, colored/labeled by scoring.js's visibilityCategory
// rather than by the same frac-style thresholds as verdictColor/verdictLabel —
// a fully clear-but-badly-angled point must not read as "Blocked."
const CATEGORY_COLOR = {
  blocked: BLOCKED_COLOR,
  "poor-angle": POOR_ANGLE_COLOR,
  partial: PARTIAL_COLOR,
  good: VISIBLE_COLOR,
};

const CATEGORY_LABEL = {
  blocked: "Blocked",
  "poor-angle": "Bad angle",
  partial: "Partially blocked",
  good: "Good spot",
};

// lib/geo/normalizeBuilding.js's HEIGHT_SOURCE_CONFIDENCE tiers, spelled out
// for the user — this is meant to build trust, not read as a caveat, so it
// says what IS known rather than just hedging ("estimated" alone reads as
// "we don't know," when medium/low actually do have a documented basis).
const CONFIDENCE_LABEL = {
  high: "Height is directly reported for this building.",
  medium: "Height is estimated from floor count or community-sourced data.",
  low: "Height is a rough estimate — no direct data for this building.",
};

const DEFAULT_CHART_WIDTH = 280;
const DEFAULT_CHART_HEIGHT = 170;
const PAD_LEFT = 40;
const PAD_RIGHT = 12;
const PAD_TOP = 14;
const PAD_BOTTOM = 22;
const HORIZON_CHART_METERS = 2500;
const HAZE_HINT_METERS = 10000;

function plotSize(width, height) {
  return {
    width,
    height,
    plotWidth: width - PAD_LEFT - PAD_RIGHT,
    plotHeight: height - PAD_TOP - PAD_BOTTOM,
  };
}

function SightlineChart({ profile, isDark, width = DEFAULT_CHART_WIDTH, height = DEFAULT_CHART_HEIGHT }) {
  const { width: W, height: H, plotWidth, plotHeight } = plotSize(width, height);
  const {
    totalDistance, eyeHeight, targetHeight, shellRadius, frac, hits,
  } = profile;
  // Phase 5 added the absolute-altitude fields and terrainProfile.
  // Older callers (and pre-Phase-5 tests) hand us the pre-Phase-5 shape;
  // fall back so the chart renders identically to before in that case
  // (relative altitudes with a flat, empty terrain).
  const observerGroundElev = profile.observerGroundElev ?? 0;
  const launchElev = profile.launchElev ?? 0;
  const observerAbsAlt = profile.observerAbsAlt ?? eyeHeight;
  const targetAbsAlt = profile.targetAbsAlt ?? targetHeight;
  const terrainProfile = profile.terrainProfile ?? [];

  // Everything plotted on one absolute-altitude axis, so buildings
  // (whose height is absolute post-Phase-3) sit next to observer eye
  // (observerAbsAlt) and burst (targetAbsAlt) at consistent altitude
  // even in hilly terrain. Pre-Phase-3 code path (no terrain) has
  // observerGroundElev = launchElev = 0, so this collapses to the old
  // "everything relative to sea level = same as relative to ground"
  // behavior automatically.
  const bandTop = targetAbsAlt + shellRadius;
  const bandBottom = targetAbsAlt - shellRadius;
  const maxHitHeight = hits.reduce((m, h) => Math.max(m, h.height), 0);
  const maxTerrainElev = terrainProfile.reduce((m, s) => Math.max(m, s.elevation), 0);
  const maxY = Math.max(bandTop, maxHitHeight, observerAbsAlt, maxTerrainElev) * 1.1;
  // With terrain, the chart may want a floor below 0 (e.g., burst near
  // sea level, terrain higher). For now stick with 0 baseline — the SF
  // case has everything ≥ 0m ASL and adjusting per-analysis would
  // introduce chart jitter across nearby launches.
  const minY = 0;

  const ink = isDark ? "#c3c2b7" : "#52514e";
  const baseline = isDark ? "#383835" : "#c3c2b7";
  const terrainFill = isDark ? "#5c4a38" : "#d4c3a8";
  const nonBlockingFill = "#898781";
  const blockColor = verdictColor(frac);

  const xAt = (distance) => PAD_LEFT + (distance / totalDistance) * plotWidth;
  const yAt = (h) => PAD_TOP + plotHeight - ((h - minY) / (maxY - minY)) * plotHeight;

  const bottomY = yAt(minY);
  const blockerReq = hits.length > 0 ? Math.max(...hits.map((h) => h.req)) : null;

  // Terrain silhouette: closed polygon that traces the ground profile,
  // closing at the chart's bottom line. Renders first so buildings and
  // sightline overlay it. When terrainGrid is absent, all elevations
  // are 0 and the polygon collapses to a flat strip along the x-axis —
  // visually indistinguishable from the ground line we already drew,
  // so no special-case needed.
  const terrainPath = (() => {
    if (terrainProfile.length < 2) return "";
    const pts = terrainProfile.map((s) => `${xAt(s.distance).toFixed(2)},${yAt(s.elevation).toFixed(2)}`).join(" L ");
    return `M ${xAt(0).toFixed(2)},${bottomY.toFixed(2)} L ${pts} L ${xAt(totalDistance).toFixed(2)},${bottomY.toFixed(2)} Z`;
  })();

  return (
    <svg width={W} height={H} role="img" aria-label={`Sightline profile, ${Math.round(frac * 100)}% visible`}>
      {/* terrain silhouette (drawn first so buildings and sightline sit on top) */}
      {terrainPath && <path d={terrainPath} fill={terrainFill} opacity={0.55} />}

      {/* ground reference line at sea level */}
      <line x1={PAD_LEFT} y1={bottomY} x2={W - PAD_RIGHT} y2={bottomY} stroke={baseline} strokeWidth={1} />

      {/* the building the observer is standing on, if eyeHeight is elevated
          above just standing at ground level — otherwise "you" would read as
          floating in midair with nothing under it. eyeHeight is the RELATIVE
          input value (meters above local ground) so the comparison against
          the raw EYE_HEIGHT constant still works regardless of terrain. */}
      {eyeHeight > EYE_HEIGHT + 0.5 && (
        <rect
          x={xAt(0) - Math.max(4, plotWidth * 0.012) / 2}
          y={yAt(observerAbsAlt)}
          width={Math.max(4, plotWidth * 0.012)}
          height={yAt(observerGroundElev) - yAt(observerAbsAlt)}
          fill={nonBlockingFill}
          opacity={0.4}
        />
      )}

      {/* buildings */}
      {hits.map((hit, i) => {
        const isBlocker = hit.req === blockerReq;
        const x = xAt(hit.distance);
        const barWidth = Math.max(4, plotWidth * 0.01);
        // Building base: sample terrain at hit.distance (interpolated
        // from terrainProfile) so bars stand on the ground silhouette
        // rather than floating above/below it. Fall back to sea level
        // when terrain isn't loaded — cosmetically same as pre-Phase-5.
        const baseElev = interpolateTerrain(terrainProfile, hit.distance);
        return (
          <rect
            key={i}
            x={x - barWidth / 2}
            y={yAt(hit.height)}
            width={barWidth}
            height={yAt(baseElev) - yAt(hit.height)}
            fill={isBlocker ? blockColor : nonBlockingFill}
            opacity={isBlocker ? 0.9 : 0.6}
          >
            <title>{`${Math.round(hit.height)}m building (${hit.confidence} confidence), ${Math.round(hit.distance)}m from you`}</title>
          </rect>
        );
      })}

      {/* sightline, drawn after the buildings so a tall blocker visually cuts it off */}
      <line
        x1={xAt(0)}
        y1={yAt(observerAbsAlt)}
        x2={xAt(totalDistance)}
        y2={yAt(targetAbsAlt)}
        stroke={isDark ? "#3987e5" : "#2a78d6"}
        strokeWidth={2}
      />

      {/* firework shell band at the launch point */}
      <rect
        x={xAt(totalDistance) - 5}
        y={yAt(bandTop)}
        width={10}
        height={yAt(bandBottom) - yAt(bandTop)}
        fill={verdictColor(frac)}
        opacity={0.25}
      />
      <circle cx={xAt(totalDistance)} cy={yAt(targetAbsAlt)} r={3} fill={verdictColor(frac)} />

      {/* axis labels */}
      <text x={PAD_LEFT} y={H - 4} fontSize={10} fill={ink}>you</text>
      <text x={W - PAD_RIGHT} y={H - 4} fontSize={10} textAnchor="end" fill={ink}>launch point</text>
      <text x={4} y={PAD_TOP + 8} fontSize={10} fill={ink}>{Math.round(maxY)}m</text>
      <text x={4} y={bottomY} fontSize={10} fill={ink}>{Math.round(minY)}m</text>
    </svg>
  );
}

// Simple piecewise-linear lookup on the terrainProfile samples. Called for
// building bases so bars stand on the drawn ground silhouette instead of
// floating.
function interpolateTerrain(profile, distance) {
  if (profile.length === 0) return 0;
  if (distance <= profile[0].distance) return profile[0].elevation;
  if (distance >= profile[profile.length - 1].distance) return profile[profile.length - 1].elevation;
  for (let i = 1; i < profile.length; i++) {
    if (profile[i].distance >= distance) {
      const a = profile[i - 1];
      const b = profile[i];
      const t = (distance - a.distance) / (b.distance - a.distance);
      return a.elevation + t * (b.elevation - a.elevation);
    }
  }
  return 0;
}

function elevAngleDeg(aslMeters, distance, observerAbsAlt) {
  if (!(distance > 0)) return 0;
  return Math.atan2(apparentAltitude(aslMeters, distance) - observerAbsAlt, distance) * (180 / Math.PI);
}

function HorizonChart({ profile, isDark, width = DEFAULT_CHART_WIDTH, height = DEFAULT_CHART_HEIGHT }) {
  const { width: W, height: H, plotWidth, plotHeight } = plotSize(width, height);
  const {
    totalDistance, observerAbsAlt, targetApparentAlt, shellRadius, frac, hits, phi, terrainProfile,
  } = profile;
  const observerAlt = observerAbsAlt ?? profile.eyeHeight ?? EYE_HEIGHT;
  const targetAlt = targetApparentAlt ?? profile.targetAbsAlt ?? profile.targetHeight;
  const terrain = terrainProfile ?? [];

  const shellTop = elevAngleDeg(targetAlt + shellRadius, totalDistance, observerAlt);
  const shellBot = elevAngleDeg(targetAlt - shellRadius, totalDistance, observerAlt);
  const sightline = typeof phi === "number" ? phi : elevAngleDeg(targetAlt, totalDistance, observerAlt);

  const terrainAngles = terrain.map((s) => elevAngleDeg(s.elevation, s.distance, observerAlt));
  const hitAngles = hits.map((h) => elevAngleDeg(h.height, h.distance, observerAlt));
  const maxY = Math.max(shellTop, sightline, ...hitAngles, ...terrainAngles, 1);
  const minY = Math.min(shellBot, ...terrainAngles, 0);
  const span = Math.max(1e-3, maxY - minY);

  const ink = isDark ? "#c3c2b7" : "#52514e";
  const baseline = isDark ? "#383835" : "#c3c2b7";
  const terrainFill = isDark ? "#5c4a38" : "#d4c3a8";
  const blockColor = verdictColor(frac);

  const xAt = (distance) => PAD_LEFT + (Math.sqrt(Math.max(0, distance)) / Math.sqrt(totalDistance)) * plotWidth;
  const yAt = (deg) => PAD_TOP + plotHeight - ((deg - minY) / span) * plotHeight;

  const bottomY = yAt(minY);
  const blockerReq = hits.length > 0 ? Math.max(...hits.map((h) => h.req)) : null;

  const terrainPath = (() => {
    if (terrain.length < 2) return "";
    const pts = terrain.map((s, i) => `${xAt(s.distance).toFixed(2)},${yAt(terrainAngles[i]).toFixed(2)}`).join(" L ");
    return `M ${xAt(0).toFixed(2)},${bottomY.toFixed(2)} L ${pts} L ${xAt(totalDistance).toFixed(2)},${bottomY.toFixed(2)} Z`;
  })();

  return (
    <svg width={W} height={H} role="img" aria-label={`Horizon profile, ${Math.round(frac * 100)}% visible`}>
      {terrainPath && <path d={terrainPath} fill={terrainFill} opacity={0.55} />}
      <line x1={PAD_LEFT} y1={yAt(sightline)} x2={W - PAD_RIGHT} y2={yAt(sightline)} stroke={isDark ? "#3987e5" : "#2a78d6"} strokeWidth={2} />
      <rect
        x={PAD_LEFT}
        y={yAt(shellTop)}
        width={plotWidth}
        height={Math.max(1, yAt(shellBot) - yAt(shellTop))}
        fill={blockColor}
        opacity={0.12}
      />
      {hits.map((hit, i) => {
        const isBlocker = hit.req === blockerReq;
        const x = xAt(hit.distance);
        const ground = elevAngleDeg(
          interpolateTerrain(terrain, hit.distance),
          hit.distance,
          observerAlt,
        );
        return (
          <line
            key={i}
            x1={x}
            y1={yAt(ground)}
            x2={x}
            y2={yAt(hitAngles[i])}
            stroke={isBlocker ? blockColor : "#898781"}
            strokeWidth={isBlocker ? 3 : 2}
            opacity={isBlocker ? 0.95 : 0.6}
          >
            <title>{`${Math.round(hit.height)}m building, ${Math.round(hit.distance)}m`}</title>
          </line>
        );
      })}
      <line x1={PAD_LEFT} y1={bottomY} x2={W - PAD_RIGHT} y2={bottomY} stroke={baseline} strokeWidth={1} />
      <text x={PAD_LEFT} y={H - 4} fontSize={10} fill={ink}>you</text>
      <text x={W - PAD_RIGHT} y={H - 4} fontSize={10} textAnchor="end" fill={ink}>launch</text>
      <text x={4} y={PAD_TOP + 8} fontSize={10} fill={ink}>{maxY.toFixed(1)}°</text>
      <text x={4} y={bottomY} fontSize={10} fill={ink}>{minY.toFixed(1)}°</text>
    </svg>
  );
}

HorizonChart.propTypes = {
  profile: PropTypes.object.isRequired,
  isDark: PropTypes.bool,
  width: PropTypes.number,
  height: PropTypes.number,
};

SightlineChart.propTypes = {
  profile: PropTypes.object.isRequired,
  isDark: PropTypes.bool,
  width: PropTypes.number,
  height: PropTypes.number,
};

function useMeasuredWidth(enabled, fallback = 640) {
  const ref = useRef(null);
  const lastRef = useRef(fallback);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    const apply = (raw) => {
      const next = Math.max(320, Math.floor(raw) || lastRef.current || fallback);
      lastRef.current = next;
      setWidth((prev) => (prev === next ? prev : next));
    };
    apply(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect?.width;
      if (next) apply(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled, fallback]);
  return [ref, width];
}

export default function ProfilePanel({ isDark, layout = "panel" }) {
  const { analysis, viewerLevel, setViewerLevel } = useLaunchAnalysis() ?? {};
  const isDock = layout === "dock";
  const [chartHostRef, chartWidth] = useMeasuredWidth(
    isDock && Boolean(analysis?.observer && analysis?.profile),
  );
  const mutedColor = "rgba(0,0,0,0.4)";
  const promptSx = {
    height: isDock ? PROFILE_DOCK_PROMPT_PX : undefined,
    px: 2,
    py: isDock ? 0 : 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    color: isDark ? "rgba(255,255,255,0.5)" : mutedColor,
    fontFamily: "Montserrat, sans-serif",
    fontSize: 13,
  };

  if (!analysis) {
    return <Box sx={promptSx}>Set a launch point to analyze visibility.</Box>;
  }

  if (!analysis.observer || !analysis.profile) {
    if (analysis.loading) {
      return (
        <Box sx={{ ...promptSx, height: isDock ? "100%" : undefined }}>
          Loading buildings and terrain along the sightline…
        </Box>
      );
    }
    if (analysis.fetchError) {
      return (
        <Box sx={{ ...promptSx, height: isDock ? "100%" : undefined }}>
          Couldn&apos;t load map data for that sightline. Try another spot.
        </Box>
      );
    }
    return <Box sx={promptSx}>Use “Check a viewing spot”, then click anywhere on the map.</Box>;
  }

  const { profile, observerBuilding } = analysis;
  const { minAlt, frac, hits } = profile;
  const color = verdictColor(frac);
  const label = verdictLabel(frac);
  // The building that actually drives the verdict — same "max req" logic
  // SightlineChart uses to pick isBlocker — is the one whose height accuracy
  // matters to how much the user should trust this result.
  const blocker = hits.length > 0
    ? hits.reduce((tallest, h) => (h.req >= tallest.req ? h : tallest), hits[0])
    : null;
  const level = viewerLevel ?? { mode: "ground", floor: 1 };
  const captionColor = isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.4)";
  const copyGap = 1.5;
  const chartW = isDock ? chartWidth : DEFAULT_CHART_WIDTH;
  const chartH = isDock ? PROFILE_DOCK_CHART_PX : DEFAULT_CHART_HEIGHT;
  const Chart = profile.totalDistance >= HORIZON_CHART_METERS ? HorizonChart : SightlineChart;
  const distanceLabel = profile.totalDistance >= 1000
    ? `${(profile.totalDistance / 1000).toFixed(1)} km from launch`
    : `${Math.round(profile.totalDistance)}m from launch`;
  const verdictDetail = frac >= 1
    ? "Nothing blocks the shell — fully visible."
    : frac <= 0
      ? `Fully blocked — you'd need to reach ${Math.round(minAlt)}m to clear the tallest obstruction.`
      : `Partially blocked — reaching ${Math.round(minAlt)}m would clear it entirely.`;
  const hintBits = [
    blocker?.name ? `Closest issue: ${blocker.name}.` : "",
    profile.dataIncomplete
      ? "Some map tiles along this sightline couldn't be loaded."
      : "",
    profile.totalDistance >= HAZE_HINT_METERS
      ? `At this distance the shell is only ${profile.theta.toFixed(2)}° across — haze and city lights matter.`
      : "",
  ].filter(Boolean).join(" ");

  const floorPicker = observerBuilding && setViewerLevel ? (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexShrink: 0 }}>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={level.mode}
        onChange={(_, mode) => mode && setViewerLevel({ ...level, mode })}
      >
        <ToggleButton value="ground">Ground</ToggleButton>
        <ToggleButton value="floor">Floor</ToggleButton>
        <ToggleButton value="rooftop">Rooftop</ToggleButton>
      </ToggleButtonGroup>
      {level.mode === "floor" && (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 160 }}>
          <Typography variant="caption" sx={{ whiteSpace: "nowrap" }}>
            {Math.min(Math.max(1, level.floor), observerBuilding.maxFloors)}/{observerBuilding.maxFloors}
          </Typography>
          <Slider
            size="small"
            min={1}
            max={observerBuilding.maxFloors}
            value={Math.min(Math.max(1, level.floor), observerBuilding.maxFloors)}
            onChangeCommitted={(_, floor) => setViewerLevel({ ...level, floor })}
          />
        </Stack>
      )}
    </Stack>
  ) : null;

  const copy = (
    <>
      {/* Mirror of the launch point's rooftop handling (todo.md P1-3), but
          for the observer's end of the sightline — a clicked point that sits
          on a building isn't necessarily viewed from ground level, and the
          algorithm has no way to guess which floor without being told. */}
      {observerBuilding && setViewerLevel && (
        <Box sx={{ mb: copyGap }}>
          <Typography variant="caption" component="p" sx={{ mb: 0.5 }}>
            This spot is on a ~{Math.round(observerBuilding.height)}m building — how high up are you?
          </Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={level.mode}
            onChange={(_, mode) => mode && setViewerLevel({ ...level, mode })}
          >
            <ToggleButton value="ground">Ground</ToggleButton>
            <ToggleButton value="floor">Floor</ToggleButton>
            <ToggleButton value="rooftop">Rooftop</ToggleButton>
          </ToggleButtonGroup>
          {level.mode === "floor" && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption">
                Floor {Math.min(Math.max(1, level.floor), observerBuilding.maxFloors)} of ~{observerBuilding.maxFloors}
              </Typography>
              <Slider
                size="small"
                min={1}
                max={observerBuilding.maxFloors}
                value={Math.min(Math.max(1, level.floor), observerBuilding.maxFloors)}
                onChangeCommitted={(_, floor) => setViewerLevel({ ...level, floor })}
              />
            </Box>
          )}
          {observerBuilding.confidence !== "high" && (
            <Typography variant="caption" component="p" sx={{ color: captionColor }}>
              {CONFIDENCE_LABEL[observerBuilding.confidence]}
            </Typography>
          )}
        </Box>
      )}

      {profile.dataIncomplete && (
        <Typography variant="caption" component="p" sx={{ mb: copyGap, color: isDark ? "#ef9a9a" : "#c62828" }}>
          Some map tiles along this sightline couldn&apos;t be loaded. A &quot;clear&quot; result here may be missing buildings or hills in the gaps.
        </Typography>
      )}

      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
        <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
        <Typography variant="subtitle2" sx={{ fontFamily: "Montserrat, sans-serif" }}>
          {label} — {Math.round(frac * 100)}% of the shell
        </Typography>
      </Stack>

      <Typography variant="caption" component="p" sx={{ mb: copyGap, color: isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.6)" }}>
        {verdictDetail}
        {blocker?.name ? ` Closest issue: ${blocker.name}.` : ""}
        {" "}
        {profile.totalDistance >= 1000
          ? `${(profile.totalDistance / 1000).toFixed(1)} km from the launch point.`
          : `${Math.round(profile.totalDistance)}m from the launch point.`}
      </Typography>

      {profile.totalDistance >= HAZE_HINT_METERS && (
        <Typography variant="caption" component="p" sx={{ mb: copyGap, color: isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.55)" }}>
          Geometrically this line of sight is {frac >= 1 ? "clear" : "computed as shown"}, but at this distance the shell is only {profile.theta.toFixed(2)}° across. What you actually see depends on haze and city lights that night.
        </Typography>
      )}

      {blocker && (
        <Typography variant="caption" component="p" sx={{ mb: copyGap, color: captionColor }}>
          {CONFIDENCE_LABEL[blocker.confidence]}
        </Typography>
      )}

      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: CATEGORY_COLOR[profile.category], flexShrink: 0 }} />
        <Typography variant="caption">
          Overall viewing quality: {Math.round(profile.score * 100)}% ({CATEGORY_LABEL[profile.category]})
        </Typography>
      </Stack>
      <Typography variant="caption" component="p" sx={{ mb: copyGap, color: captionColor }}>
        Accounts for the shell&apos;s apparent size ({profile.theta.toFixed(1)}°) and viewing angle
        ({profile.phi.toFixed(1)}°), not just whether anything blocks it.
      </Typography>

      {/* Coverage caveat — mirrors the LaunchPointControl disclaimer.
          Post-Phase-5 the sightline math factors in both buildings AND
          terrain (see 地形高程集成_实施方案.md); still not modeled:
          trees and weather. Kept per-spot so a user seeing "Visible —
          100%" at a park edge knows the tree canopy isn't in the number. */}
      <Typography variant="caption" component="p" sx={{ mb: 1.5, fontStyle: "italic", color: captionColor }}>
        Analysis considers buildings and terrain — trees and weather aren&apos;t factored in.
      </Typography>
    </>
  );

  const chart = <Chart profile={profile} isDark={isDark} width={chartW} height={chartH} />;

  if (!isDock) {
    return (
      <Box sx={{ p: 2 }}>
        {copy}
        {chart}
      </Box>
    );
  }

  const headerTitle = observerBuilding
    ? `This spot is on a ~${Math.round(observerBuilding.height)}m building`
    : `${verdictDetail} ${distanceLabel}.`;

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{
          height: PROFILE_DOCK_HEADER_PX,
          px: 2,
          alignItems: "center",
          overflow: "hidden",
          borderBottom: isDark
            ? "1px solid rgba(255,255,255,0.08)"
            : "1px solid rgba(0,0,0,0.08)",
        }}
      >
        <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
        <Typography variant="subtitle2" sx={{ fontFamily: "Montserrat, sans-serif", whiteSpace: "nowrap" }}>
          {label} — {Math.round(frac * 100)}%
        </Typography>
        <Typography
          variant="caption"
          title={hintBits || headerTitle}
          sx={{
            color: isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.6)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
            flex: 1,
          }}
        >
          {verdictDetail} {distanceLabel}.
          {blocker?.name ? ` ${blocker.name}.` : ""}
          {" "}
          Quality {Math.round(profile.score * 100)}% ({CATEGORY_LABEL[profile.category]}).
        </Typography>
        {analysis.loading && (
          <Typography variant="caption" sx={{ color: captionColor, flexShrink: 0 }}>
            Updating…
          </Typography>
        )}
        {floorPicker}
      </Stack>
      <Box
        ref={chartHostRef}
        sx={{
          height: PROFILE_DOCK_CHART_PX,
          minWidth: 0,
          display: "flex",
          alignItems: "stretch",
          justifyContent: "stretch",
          overflow: "hidden",
        }}
      >
        {chart}
      </Box>
    </Box>
  );
}

ProfilePanel.propTypes = {
  isDark: PropTypes.bool,
  layout: PropTypes.oneOf(["panel", "dock"]),
};

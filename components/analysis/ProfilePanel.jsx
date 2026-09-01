import PropTypes from "prop-types";
import { Box, Typography, Stack, ToggleButton, ToggleButtonGroup, Slider } from "@mui/material";
import { useLaunchAnalysis } from "@/lib/LaunchContext";
import { EYE_HEIGHT } from "@/lib/viewshed/scoring";

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

const WIDTH = 280;
const HEIGHT = 170;
const PAD_LEFT = 34;
const PAD_RIGHT = 10;
const PAD_TOP = 14;
const PAD_BOTTOM = 22;
const PLOT_WIDTH = WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_HEIGHT = HEIGHT - PAD_TOP - PAD_BOTTOM;

function SightlineChart({ profile, isDark }) {
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

  const xAt = (distance) => PAD_LEFT + (distance / totalDistance) * PLOT_WIDTH;
  const yAt = (h) => PAD_TOP + PLOT_HEIGHT - ((h - minY) / (maxY - minY)) * PLOT_HEIGHT;

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
    <svg width={WIDTH} height={HEIGHT} role="img" aria-label={`Sightline profile, ${Math.round(frac * 100)}% visible`}>
      {/* terrain silhouette (drawn first so buildings and sightline sit on top) */}
      {terrainPath && <path d={terrainPath} fill={terrainFill} opacity={0.55} />}

      {/* ground reference line at sea level */}
      <line x1={PAD_LEFT} y1={bottomY} x2={WIDTH - PAD_RIGHT} y2={bottomY} stroke={baseline} strokeWidth={1} />

      {/* the building the observer is standing on, if eyeHeight is elevated
          above just standing at ground level — otherwise "you" would read as
          floating in midair with nothing under it. eyeHeight is the RELATIVE
          input value (meters above local ground) so the comparison against
          the raw EYE_HEIGHT constant still works regardless of terrain. */}
      {eyeHeight > EYE_HEIGHT + 0.5 && (
        <rect
          x={xAt(0) - Math.max(4, PLOT_WIDTH * 0.03) / 2}
          y={yAt(observerAbsAlt)}
          width={Math.max(4, PLOT_WIDTH * 0.03)}
          height={yAt(observerGroundElev) - yAt(observerAbsAlt)}
          fill={nonBlockingFill}
          opacity={0.4}
        />
      )}

      {/* buildings */}
      {hits.map((hit, i) => {
        const isBlocker = hit.req === blockerReq;
        const x = xAt(hit.distance);
        const barWidth = Math.max(4, PLOT_WIDTH * 0.03);
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
      <text x={PAD_LEFT} y={HEIGHT - 4} fontSize={10} fill={ink}>you</text>
      <text x={WIDTH - PAD_RIGHT} y={HEIGHT - 4} fontSize={10} textAnchor="end" fill={ink}>launch point</text>
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

SightlineChart.propTypes = {
  profile: PropTypes.object.isRequired,
  isDark: PropTypes.bool,
};

export default function ProfilePanel({ isDark }) {
  const { analysis, viewerLevel, setViewerLevel } = useLaunchAnalysis() ?? {};
  const mutedColor = "rgba(0,0,0,0.4)";
  const promptSx = {
    p: 2,
    textAlign: "center",
    color: isDark ? "rgba(255,255,255,0.5)" : mutedColor,
    fontFamily: "Montserrat, sans-serif",
    fontSize: 13,
  };

  if (!analysis) {
    return <Box sx={promptSx}>Set a launch point to analyze visibility.</Box>;
  }

  if (!analysis.observer || !analysis.profile) {
    return <Box sx={promptSx}>Click anywhere on the map to see whether that spot can see the launch.</Box>;
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

  return (
    <Box sx={{ p: 2 }}>
      {/* Mirror of the launch point's rooftop handling (todo.md P1-3), but
          for the observer's end of the sightline — a clicked point that sits
          on a building isn't necessarily viewed from ground level, and the
          algorithm has no way to guess which floor without being told. */}
      {observerBuilding && setViewerLevel && (
        <Box sx={{ mb: 1.5 }}>
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
            <Typography variant="caption" component="p" sx={{ color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.4)" }}>
              {CONFIDENCE_LABEL[observerBuilding.confidence]}
            </Typography>
          )}
        </Box>
      )}

      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
        <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
        <Typography variant="subtitle2" sx={{ fontFamily: "Montserrat, sans-serif" }}>
          {label} — {Math.round(frac * 100)}% of the shell
        </Typography>
      </Stack>

      <Typography variant="caption" component="p" sx={{ mb: 1.5, color: isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.6)" }}>
        {frac >= 1
          ? "Nothing blocks the shell — fully visible."
          : frac <= 0
            ? `Fully blocked — you'd need to reach ${Math.round(minAlt)}m to clear the tallest obstruction.`
            : `Partially blocked — reaching ${Math.round(minAlt)}m would clear it entirely.`}
        {" "}{Math.round(profile.totalDistance)}m from the launch point.
      </Typography>

      {blocker && (
        <Typography variant="caption" component="p" sx={{ mb: 1.5, color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.4)" }}>
          {CONFIDENCE_LABEL[blocker.confidence]}
        </Typography>
      )}

      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: CATEGORY_COLOR[profile.category], flexShrink: 0 }} />
        <Typography variant="caption">
          Overall viewing quality: {Math.round(profile.score * 100)}% ({CATEGORY_LABEL[profile.category]})
        </Typography>
      </Stack>
      <Typography variant="caption" component="p" sx={{ mb: 1.5, color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.4)" }}>
        Accounts for the shell&apos;s apparent size ({profile.theta.toFixed(1)}°) and viewing angle
        ({profile.phi.toFixed(1)}°), not just whether anything blocks it.
      </Typography>

      {/* Coverage caveat — mirrors the LaunchPointControl disclaimer.
          Post-Phase-5 the sightline math factors in both buildings AND
          terrain (see 地形高程集成_实施方案.md); still not modeled:
          trees and weather. Kept per-spot so a user seeing "Visible —
          100%" at a park edge knows the tree canopy isn't in the number. */}
      <Typography variant="caption" component="p" sx={{ mb: 1.5, fontStyle: "italic", color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.4)" }}>
        Analysis considers buildings and terrain — trees and weather aren&apos;t factored in.
      </Typography>

      <SightlineChart profile={profile} isDark={isDark} />
    </Box>
  );
}

ProfilePanel.propTypes = {
  isDark: PropTypes.bool,
};

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
const HAZE_HINT_METERS = 10000;
// Width of the perspective-preview panel that sits beside the chart in dock
// mode. The chart takes whatever's left after this — measured live so a
// change here doesn't ripple.
const PREVIEW_DOCK_WIDTH = 320;

function plotSize(width, height) {
  return {
    width,
    height,
    plotWidth: width - PAD_LEFT - PAD_RIGHT,
    plotHeight: height - PAD_TOP - PAD_BOTTOM,
  };
}

// Piecewise-linear lookup on the terrainProfile samples. Building bars stand
// on the interpolated ground rather than floating.
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

/**
 * One chart for every observer→launch distance, from 20m to 30km. Y is the
 * elevation angle from the observer's eye (degrees), so a 100m ridge 500m
 * away and a 100m ridge 5km away render at the visual size they'd actually
 * take up in the viewer's field of vision — matching human perception and
 * automatically down-weighting distant obstacles the way the old absolute-
 * meters chart couldn't. X is √distance so near buildings (where individual
 * bar identity matters most) get more pixels than far ones (where they'd
 * blur into a hairline band anyway). See
 * `自由放置观察点与远距离剖面图_工程设计文档.md` §4.
 *
 * Buildings render as thin per-hit bars — at close range each one stands
 * on its own, at far range they overlay into a natural urban-skyline
 * silhouette. The single blocker (max-req hit) gets its own wider,
 * verdict-colored bar drawn on top, so "why is this blocked" reads at a
 * glance instead of hunting through 300 similar-looking bars.
 */
function SkylineChart({ profile, isDark, width = DEFAULT_CHART_WIDTH, height = DEFAULT_CHART_HEIGHT }) {
  const { width: W, height: H, plotWidth, plotHeight } = plotSize(width, height);
  const { totalDistance, shellRadius, frac, hits, phi } = profile;
  // Phase 5 shape fields; pre-Phase-5 tests hand us the old shape, so fall
  // back the same way the previous two charts did.
  const observerAlt = profile.observerAbsAlt ?? profile.eyeHeight ?? EYE_HEIGHT;
  const targetAlt = profile.targetAbsAlt ?? profile.targetHeight;
  const terrain = profile.terrainProfile ?? [];

  // Elevation angle from observer eye to (distance, absAlt), curvature/
  // refraction applied on the far side. Angle is degrees, positive = above
  // horizon.
  const angleAt = (absAlt, distance) => {
    if (!(distance > 0)) return 0;
    return Math.atan2(apparentAltitude(absAlt, distance) - observerAlt, distance) * (180 / Math.PI);
  };

  const shellTop = angleAt(targetAlt + shellRadius, totalDistance);
  const shellBot = angleAt(targetAlt - shellRadius, totalDistance);
  const sightline = typeof phi === "number" ? phi : angleAt(targetAlt, totalDistance);

  const hitAngles = hits.map((h) => angleAt(h.height, h.distance));
  const hitGroundAngles = hits.map((h) => angleAt(interpolateTerrain(terrain, h.distance), h.distance));
  const terrainAngles = terrain.map((s) => angleAt(s.elevation, s.distance));

  const maxY = Math.max(shellTop, sightline, ...hitAngles, ...terrainAngles, 1);
  const minY = Math.min(shellBot, ...hitGroundAngles, ...terrainAngles, 0);
  const span = Math.max(1e-3, maxY - minY);

  const ink = isDark ? "#c3c2b7" : "#52514e";
  const baseline = isDark ? "#383835" : "#c3c2b7";
  const terrainFill = isDark ? "#5c4a38" : "#d4c3a8";
  const skylineFill = isDark ? "#8a8781" : "#8a8781";
  const blockColor = verdictColor(frac);

  const xAt = (distance) => PAD_LEFT + (Math.sqrt(Math.max(0, distance)) / Math.sqrt(totalDistance)) * plotWidth;
  const yAt = (deg) => PAD_TOP + plotHeight - ((deg - minY) / span) * plotHeight;
  const bottomY = yAt(minY);

  const terrainPath = (() => {
    if (terrain.length < 2) return "";
    const pts = terrain.map((s, i) => `${xAt(s.distance).toFixed(2)},${yAt(terrainAngles[i]).toFixed(2)}`).join(" L ");
    return `M ${xAt(0).toFixed(2)},${bottomY.toFixed(2)} L ${pts} L ${xAt(totalDistance).toFixed(2)},${bottomY.toFixed(2)} Z`;
  })();

  // Blocker: the tallest-req hit gets a distinct verdict-colored bar drawn
  // on top with a minimum pixel width so it stays visible even 20km out.
  const blockerIdx = hits.length > 0
    ? hits.reduce((best, h, i) => (h.req > hits[best].req ? i : best), 0)
    : -1;

  return (
    <svg width={W} height={H} role="img" aria-label={`Sightline profile, ${Math.round(frac * 100)}% visible`}>
      {/* terrain silhouette */}
      {terrainPath && <path d={terrainPath} fill={terrainFill} opacity={0.55} />}

      {/* shell band spans the whole viewport at the launch's angular height */}
      <rect
        x={PAD_LEFT}
        y={yAt(shellTop)}
        width={plotWidth}
        height={Math.max(1, yAt(shellBot) - yAt(shellTop))}
        fill={blockColor}
        opacity={0.14}
      />

      {/* buildings — one thin bar per hit. Sub-pixel bars in the distance
          overlay into a natural urban-skyline silhouette; the near ones
          stand on their own. */}
      {hits.map((hit, i) => {
        if (i === blockerIdx) return null;
        const x = xAt(hit.distance);
        const topY = yAt(hitAngles[i]);
        const botY = yAt(hitGroundAngles[i]);
        return (
          <rect
            key={i}
            x={x - 1}
            y={topY}
            width={2}
            height={Math.max(1, botY - topY)}
            fill={skylineFill}
            opacity={0.55}
          />
        );
      })}

      {/* sightline — from the observer (angle 0 at x=0) to the launch */}
      <line
        x1={xAt(0)}
        y1={yAt(0)}
        x2={xAt(totalDistance)}
        y2={yAt(sightline)}
        stroke={isDark ? "#3987e5" : "#2a78d6"}
        strokeWidth={2}
      />

      {/* the blocker on top of everything, verdict-colored and never
          narrower than 6px so it never vanishes at long ranges */}
      {blockerIdx >= 0 && (() => {
        const hit = hits[blockerIdx];
        const x = xAt(hit.distance);
        const topY = yAt(hitAngles[blockerIdx]);
        const botY = yAt(hitGroundAngles[blockerIdx]);
        return (
          <rect
            x={x - 3}
            y={topY}
            width={6}
            height={Math.max(1, botY - topY)}
            fill={blockColor}
            opacity={0.9}
          >
            <title>{`${Math.round(hit.height)}m building (${hit.confidence} confidence), ${Math.round(hit.distance)}m from you`}</title>
          </rect>
        );
      })()}

      {/* launch marker */}
      <circle cx={xAt(totalDistance)} cy={yAt(sightline)} r={3} fill={blockColor} />

      {/* baseline + axis labels */}
      <line x1={PAD_LEFT} y1={bottomY} x2={W - PAD_RIGHT} y2={bottomY} stroke={baseline} strokeWidth={1} />
      <text x={PAD_LEFT} y={H - 4} fontSize={10} fill={ink}>you</text>
      <text x={W - PAD_RIGHT} y={H - 4} fontSize={10} textAnchor="end" fill={ink}>launch</text>
      <text x={4} y={PAD_TOP + 8} fontSize={10} fill={ink}>{maxY.toFixed(1)}°</text>
      <text x={4} y={bottomY} fontSize={10} fill={ink}>{minY.toFixed(1)}°</text>
    </svg>
  );
}

SkylineChart.propTypes = {
  profile: PropTypes.object.isRequired,
  isDark: PropTypes.bool,
  width: PropTypes.number,
  height: PropTypes.number,
};

/**
 * "What you'd actually see from here" — a small 3D-ish silhouette rendering
 * of the observer's forward view toward the launch. Complements the
 * SkylineChart (which shows the analysis as a diagram); this shows it as
 * an approximate scene.
 *
 * Uses a pinhole camera model with the observer at the origin looking
 * along the observer→launch bearing:
 *   screen_x = focalPx * xOffset / distance
 *   screen_y = horizonY - focalPx * tan(elevationAngle)
 *
 * The compute pipeline gives us a 1D world along the sightline — no true
 * off-axis footprint or height data — so buildings get a deterministic
 * jitter to spread them off the centerline and terrain samples are
 * extruded sideways by a fake ±250m halfWidth to form a receding ground
 * ribbon. Neither is metrically accurate off-axis, but the result reads
 * unambiguously as "a landscape with things in it" and answers the "what
 * would I see" question that the number-heavy chart cannot.
 */
function PerspectivePreview({ profile, isDark, width = 320, height = 200 }) {
  const { hits, totalDistance, frac, theta } = profile;
  const observerAlt = profile.observerAbsAlt ?? profile.eyeHeight ?? EYE_HEIGHT;
  const targetAlt = profile.targetAbsAlt ?? profile.targetHeight;
  const terrainProfile = profile.terrainProfile ?? [];

  // 50° horizontal FOV — a comfortable near-peripheral human viewing
  // angle. Wide enough to show foreground buildings taking up angular
  // real estate, narrow enough to keep detail on the launch.
  const FOV_DEG = 50;
  const focalPx = width / (2 * Math.tan((FOV_DEG / 2) * Math.PI / 180));
  const centerX = width / 2;
  // Horizon slightly below chart center: leaves more room for the sky
  // (where the burst is) and less for the ground.
  const horizonY = height * 0.6;

  const elevDeg = (a, d) => (d > 0
    ? Math.atan2(apparentAltitude(a, d) - observerAlt, d) * (180 / Math.PI)
    : 0);
  const project = (d, a, xMeters = 0) => {
    if (d <= 0.5) return { x: centerX, y: horizonY };
    const e = elevDeg(a, d);
    return {
      x: centerX + focalPx * (xMeters / d),
      y: horizonY - focalPx * Math.tan(e * Math.PI / 180),
    };
  };

  // Deterministic pseudo-jitter off the exact centerline so buildings
  // don't all stack at centerX. Seeded by index so re-renders don't
  // shuffle the scene.
  const jitterMeters = (i) => {
    const seed = ((i + 1) * 2654435761) >>> 0;
    return ((seed / 0xffffffff) * 2 - 1) * 30;
  };

  const skyTop = isDark ? "#0a1a30" : "#5680b0";
  const skyHorizon = isDark ? "#4a3854" : "#f4c979";
  const groundFill = isDark ? "#0e1a12" : "#2a3826";
  const bldgColor = isDark ? "#000000" : "#101820";
  const blockColor = verdictColor(frac);
  const burstColor = frac >= 0.66 ? "#ffe066" : frac >= 0.33 ? "#ffb020" : blockColor;

  // Terrain silhouette: our data is 1D along the sightline (no true off-axis
  // terrain), so an "honest" 3D perspective extrusion collapses adjacent
  // similar-elevation samples into a zero-height strip and reads as flat.
  // Instead lay the samples out horizontally across the frame — near ones
  // on the left, far ones on the right — with y as the projected elevation
  // angle. This is a "panoramic ridgeline" reading: at each horizontal
  // angle you're looking at what's along the sightline at that distance.
  // Not metrically accurate off-axis, but it renders as an unmistakable
  // hill/valley silhouette and answers "is there something in the way?".
  const terrainMarginX = 4;
  const terrainInnerW = width - terrainMarginX * 2;
  const terrainSamples = terrainProfile
    .filter((s) => s.distance >= 0.5)
    .map((s, i, arr) => ({
      x: terrainMarginX + (arr.length > 1 ? (i / (arr.length - 1)) * terrainInnerW : terrainInnerW / 2),
      y: project(s.distance, s.elevation, 0).y,
    }));
  const terrainPath = terrainSamples.length >= 2
    ? `M ${terrainSamples[0].x.toFixed(1)},${height} L ${terrainSamples
        .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(" L ")} L ${terrainSamples[terrainSamples.length - 1].x.toFixed(1)},${height} Z`
    : "";
  // Slightly lighter than the base ground plane so hills stand out
  // against the sky as filled bumps rather than blending into the plane.
  const terrainRidgeFill = isDark ? "#14261b" : "#3a4d2f";

  const blockerIdx = hits.length > 0
    ? hits.reduce((best, h, i) => (h.req > hits[best].req ? i : best), 0)
    : -1;

  // Buildings drawn from far to near so near ones occlude far ones,
  // painter's-algorithm style.
  const bldgs = hits.map((hit, i) => ({ hit, i, isBlocker: i === blockerIdx }))
    .sort((a, b) => b.hit.distance - a.hit.distance);

  const burst = project(totalDistance, targetAlt, 0);
  const burstRadiusPx = Math.max(3, (theta / 2) * (Math.PI / 180) * focalPx);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`3D preview from viewing spot, ${Math.round(frac * 100)}% visible`}>
      <defs>
        <linearGradient id="pv-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={skyTop} />
          <stop offset="1" stopColor={skyHorizon} />
        </linearGradient>
        <radialGradient id="pv-burst" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={burstColor} stopOpacity="0.95" />
          <stop offset="0.6" stopColor={burstColor} stopOpacity="0.5" />
          <stop offset="1" stopColor={burstColor} stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect x={0} y={0} width={width} height={horizonY} fill="url(#pv-sky)" />
      <rect x={0} y={horizonY} width={width} height={height - horizonY} fill={groundFill} />

      {/* Filled burst goes behind foreground so a blocking building correctly
          paints over it. The outline marker below is drawn after everything
          so the "here's where the firework would be" hint stays visible even
          when the view is fully blocked. */}
      <circle cx={burst.x} cy={burst.y} r={burstRadiusPx} fill="url(#pv-burst)" />

      {terrainPath && <path d={terrainPath} fill={terrainRidgeFill} opacity={0.95} />}

      {bldgs.map(({ hit, i, isBlocker }) => {
        const off = jitterMeters(i);
        const base = project(hit.distance, interpolateTerrain(terrainProfile, hit.distance), off);
        const top = project(hit.distance, hit.height, off);
        const w = Math.max(1.5, 25 * focalPx / Math.max(hit.distance, 1));
        if (base.y - top.y < 0.5) return null;
        // Blocker gets a translucent scrim rather than a solid slab so a
        // very-close blocker (an 85m building 150m away is 30° tall and
        // fills over half the frame) doesn't paint out the whole scene.
        return (
          <rect
            key={i}
            x={base.x - w / 2}
            y={top.y}
            width={w}
            height={Math.max(1, base.y - top.y)}
            fill={isBlocker ? blockColor : bldgColor}
            opacity={isBlocker ? 0.7 : 0.85}
          >
            <title>{`${Math.round(hit.height)}m building, ${Math.round(hit.distance)}m away${isBlocker ? " — blocks your view" : ""}`}</title>
          </rect>
        );
      })}

      {/* Burst position marker drawn last so it's always visible — even when
          buildings/terrain have painted over the filled burst behind them,
          this outlined ring plus a crosshair says "the firework would be
          here" and lets the user picture the geometry. */}
      <circle cx={burst.x} cy={burst.y} r={Math.max(burstRadiusPx, 6)} fill="none" stroke="#fff" strokeWidth={1.2} strokeDasharray="2 3" opacity={0.9} />
      <circle cx={burst.x} cy={burst.y} r={2} fill="#fff" opacity={0.95} />

      <text x={6} y={height - 6} fontSize={9} fill="rgba(255,255,255,0.75)" fontFamily="Montserrat, sans-serif">
        approx view from viewing spot
      </text>
    </svg>
  );
}

PerspectivePreview.propTypes = {
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
  // SkylineChart uses to pick the blocker bar — is the one whose height
  // accuracy matters to how much the user should trust this result.
  const blocker = hits.length > 0
    ? hits.reduce((tallest, h) => (h.req >= tallest.req ? h : tallest), hits[0])
    : null;
  const level = viewerLevel ?? { mode: "ground", floor: 1 };
  const captionColor = isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.4)";
  const copyGap = 1.5;
  const chartW = isDock ? chartWidth : DEFAULT_CHART_WIDTH;
  const chartH = isDock ? PROFILE_DOCK_CHART_PX : DEFAULT_CHART_HEIGHT;
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

  const chart = <SkylineChart profile={profile} isDark={isDark} width={chartW} height={chartH} />;
  const preview = <PerspectivePreview profile={profile} isDark={isDark} width={PREVIEW_DOCK_WIDTH} height={chartH} />;

  if (!isDock) {
    return (
      <Box sx={{ p: 2 }}>
        {copy}
        {chart}
        <Box sx={{ mt: 1 }}>
          <PerspectivePreview profile={profile} isDark={isDark} width={DEFAULT_CHART_WIDTH} height={140} />
        </Box>
      </Box>
    );
  }

  const headerTitle = observerBuilding
    ? `This spot is on a ~${Math.round(observerBuilding.height)}m building`
    : `${verdictDetail} ${distanceLabel}.`;

  // Category and verdict live on different axes: verdict is fraction-of-shell
  // (pure blockage geometry), category folds in apparent size + elevation
  // angle. Only surface the category chip on the secondary line when it
  // actually contradicts the fraction verdict — otherwise "Blocked ...
  // Quality 0% (Blocked)" reads as a stutter.
  const verdictBucket = frac >= 0.66 ? "good" : frac >= 0.33 ? "partial" : "blocked";
  const categoryContradicts = profile.category !== verdictBucket;
  const secondaryBits = [
    distanceLabel,
    frac < 1 && frac > 0 ? `clears at ${Math.round(minAlt)}m` : null,
    frac <= 0 && Number.isFinite(minAlt) ? `needs ${Math.round(minAlt)}m to clear` : null,
    blocker?.name || null,
    categoryContradicts ? CATEGORY_LABEL[profile.category] : null,
  ].filter(Boolean).join(" · ");

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Stack
        direction="row"
        spacing={2}
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
        <Stack sx={{ minWidth: 0, flex: 1, gap: 0.25 }}>
          <Typography
            variant="subtitle2"
            sx={{
              fontFamily: "Montserrat, sans-serif",
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {label} — {Math.round(frac * 100)}% of the shell
          </Typography>
          <Typography
            variant="caption"
            title={hintBits || secondaryBits}
            sx={{
              color: isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.6)",
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {secondaryBits}
          </Typography>
        </Stack>
        {analysis.loading && (
          <Typography variant="caption" sx={{ color: captionColor, flexShrink: 0 }}>
            Updating…
          </Typography>
        )}
        {floorPicker}
      </Stack>
      <Stack
        direction="row"
        sx={{
          height: PROFILE_DOCK_CHART_PX,
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        <Box
          ref={chartHostRef}
          sx={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "stretch",
            justifyContent: "stretch",
            overflow: "hidden",
          }}
        >
          {chart}
        </Box>
        <Box
          sx={{
            width: PREVIEW_DOCK_WIDTH,
            flexShrink: 0,
            overflow: "hidden",
            borderLeft: isDark
              ? "1px solid rgba(255,255,255,0.08)"
              : "1px solid rgba(0,0,0,0.08)",
          }}
        >
          {preview}
        </Box>
      </Stack>
    </Box>
  );
}

ProfilePanel.propTypes = {
  isDark: PropTypes.bool,
  layout: PropTypes.oneOf(["panel", "dock"]),
};

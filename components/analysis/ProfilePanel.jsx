import PropTypes from "prop-types";
import { Box, Typography, Stack } from "@mui/material";
import { useLaunchAnalysis } from "@/lib/LaunchContext";

// Same red/yellow/green the map's own viewshed grid dots use (see the
// circle-color paint expression in components/launch/LaunchPointControl.jsx)
// — keeping one visual language for "how visible is this point" across the
// map and the panel, rather than introducing a second palette for the same
// concept.
const BLOCKED_COLOR = "#d32f2f";
const PARTIAL_COLOR = "#fbc02d";
const VISIBLE_COLOR = "#2e7d32";

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

const WIDTH = 280;
const HEIGHT = 170;
const PAD_LEFT = 34;
const PAD_RIGHT = 10;
const PAD_TOP = 14;
const PAD_BOTTOM = 22;
const PLOT_WIDTH = WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_HEIGHT = HEIGHT - PAD_TOP - PAD_BOTTOM;

function SightlineChart({ profile, isDark }) {
  const { totalDistance, eyeHeight, targetHeight, shellRadius, minAlt, frac, hits } = profile;

  const bandTop = targetHeight + shellRadius;
  const bandBottom = targetHeight - shellRadius;
  const maxHitHeight = hits.reduce((m, h) => Math.max(m, h.height), 0);
  const maxY = Math.max(bandTop, maxHitHeight, eyeHeight) * 1.1;

  const ink = isDark ? "#c3c2b7" : "#52514e";
  const baseline = isDark ? "#383835" : "#c3c2b7";
  const nonBlockingFill = "#898781";
  const blockColor = verdictColor(frac);

  const xAt = (distance) => PAD_LEFT + (distance / totalDistance) * PLOT_WIDTH;
  const yAt = (h) => PAD_TOP + PLOT_HEIGHT - (h / maxY) * PLOT_HEIGHT;

  const groundY = yAt(0);
  const blockerReq = hits.length > 0 ? Math.max(...hits.map((h) => h.req)) : null;

  return (
    <svg width={WIDTH} height={HEIGHT} role="img" aria-label={`Sightline profile, ${Math.round(frac * 100)}% visible`}>
      {/* ground */}
      <line x1={PAD_LEFT} y1={groundY} x2={WIDTH - PAD_RIGHT} y2={groundY} stroke={baseline} strokeWidth={1} />

      {/* buildings */}
      {hits.map((hit, i) => {
        const isBlocker = hit.req === blockerReq;
        const x = xAt(hit.distance);
        const barWidth = Math.max(4, PLOT_WIDTH * 0.03);
        return (
          <rect
            key={i}
            x={x - barWidth / 2}
            y={yAt(hit.height)}
            width={barWidth}
            height={groundY - yAt(hit.height)}
            fill={isBlocker ? blockColor : nonBlockingFill}
            opacity={isBlocker ? 0.9 : 0.6}
          >
            <title>{`${Math.round(hit.height)}m building, ${Math.round(hit.distance)}m from you`}</title>
          </rect>
        );
      })}

      {/* sightline, drawn after the buildings so a tall blocker visually cuts it off */}
      <line
        x1={xAt(0)}
        y1={yAt(eyeHeight)}
        x2={xAt(totalDistance)}
        y2={yAt(targetHeight)}
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
      <circle cx={xAt(totalDistance)} cy={yAt(targetHeight)} r={3} fill={verdictColor(frac)} />

      {/* axis labels */}
      <text x={PAD_LEFT} y={HEIGHT - 4} fontSize={10} fill={ink}>you</text>
      <text x={WIDTH - PAD_RIGHT} y={HEIGHT - 4} fontSize={10} textAnchor="end" fill={ink}>launch point</text>
      <text x={4} y={PAD_TOP + 8} fontSize={10} fill={ink}>{Math.round(maxY)}m</text>
      <text x={4} y={groundY} fontSize={10} fill={ink}>0m</text>
    </svg>
  );
}

SightlineChart.propTypes = {
  profile: PropTypes.object.isRequired,
  isDark: PropTypes.bool,
};

export default function ProfilePanel({ isDark }) {
  const { analysis } = useLaunchAnalysis() ?? {};
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

  const { profile } = analysis;
  const { minAlt, frac } = profile;
  const color = verdictColor(frac);
  const label = verdictLabel(frac);

  return (
    <Box sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
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

      <SightlineChart profile={profile} isDark={isDark} />
    </Box>
  );
}

ProfilePanel.propTypes = {
  isDark: PropTypes.bool,
};

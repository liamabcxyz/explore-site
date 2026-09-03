"use client";

import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Box, Link, Stack, Tooltip, Typography } from "@mui/material";
import { describeLocation } from "@/lib/geo/reverseGeocode";

/**
 * Small "where you're standing" strip: an inline address/name resolved
 * from Overture tiles + a one-click Google Maps link + a copy-to-
 * clipboard for that link.
 *
 * Runs `describeLocation` once per (map, coord) — the reverse-geocode
 * touches every loaded POI (thousands of features in a city view) so
 * we don't want to redo the walk on every render.
 */
export default function LocationChip({ map, coord, dense = false }) {
  const [copied, setCopied] = useState(false);

  // Re-derive whenever the point moves. `map` reference is stable
  // across renders once the map is loaded, so it's not the trigger.
  const info = useMemo(() => {
    if (!map || !coord) return null;
    try {
      return describeLocation(map, coord);
    } catch {
      const lat = coord.lat.toFixed(5);
      const lng = coord.lng.toFixed(5);
      return {
        primary: `${lat}, ${lng}`,
        secondary: null,
        source: "coords",
        gmapsUrl: `https://www.google.com/maps?q=${lat},${lng}`,
      };
    }
  }, [map, coord?.lat, coord?.lng]);

  // Auto-clear the "Copied" tooltip after 1.5s so the UI doesn't get
  // stuck in the confirmation state.
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  if (!info) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(info.gmapsUrl);
      setCopied(true);
    } catch {
      // Silent — Firefox private mode etc. can refuse; the user can
      // still click "Open in Google Maps" to get to the same place.
    }
  };

  const pinFont = dense ? 12 : 14;
  const bodyFont = dense ? 11 : 12;

  return (
    <Stack
      direction="row"
      spacing={dense ? 0.75 : 1.25}
      sx={{
        alignItems: "center",
        flexWrap: "wrap",
        rowGap: 0.25,
      }}
    >
      <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
        <span aria-hidden style={{ fontSize: pinFont, lineHeight: 1 }}>📍</span>
        <Typography
          variant="body2"
          sx={{
            fontSize: bodyFont,
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: dense ? 220 : 320,
          }}
          title={info.secondary || info.primary}
        >
          {info.primary}
        </Typography>
        {info.secondary && !dense && (
          <Typography
            variant="caption"
            sx={{
              fontSize: bodyFont - 1,
              color: "text.secondary",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 260,
            }}
            title={info.secondary}
          >
            · {info.secondary}
          </Typography>
        )}
      </Box>
      <Link
        href={info.gmapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        sx={{ fontSize: bodyFont, whiteSpace: "nowrap" }}
      >
        Open in Google Maps ↗
      </Link>
      <Tooltip title={copied ? "Copied!" : "Copy Google Maps link"} placement="top">
        <Link
          component="button"
          type="button"
          onClick={handleCopy}
          sx={{
            fontSize: bodyFont,
            whiteSpace: "nowrap",
            textDecoration: "underline",
            background: "none",
            border: "none",
            cursor: "pointer",
            p: 0,
          }}
        >
          {copied ? "Copied ✓" : "Copy link"}
        </Link>
      </Tooltip>
    </Stack>
  );
}

LocationChip.propTypes = {
  map: PropTypes.object,
  coord: PropTypes.shape({
    lat: PropTypes.number.isRequired,
    lng: PropTypes.number.isRequired,
  }),
  dense: PropTypes.bool,
};

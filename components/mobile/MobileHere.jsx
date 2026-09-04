"use client";

import { useEffect, useMemo, useState } from "react";
import { Box, Button, CircularProgress, Link, Stack, Typography } from "@mui/material";
import { useMyLocation } from "@/lib/hooks/useMyLocation";
import { pickNearestShow } from "@/lib/data/shows";
import { deriveShellParams } from "@/lib/viewshed/caliber";
import { loadBuildingsAlongCorridor, CORRIDOR_BUFFER_METERS } from "@/lib/geo/corridorBuildings";
import { loadElevationGridForCorridor } from "@/lib/viewshed/ElevationGrid";
import { computeSightlineProfile } from "@/lib/viewshed/computeProfile";
import { loadPmtilesFromStac } from "@/lib/stacService";
import { describeLocation, needsRefine, refineWithNominatim } from "@/lib/geo/reverseGeocode";

// Verdict palette — matches the analysis heatmap so a user who's used
// the desktop map before recognizes the colors immediately.
const VERDICT = {
  good:    { color: "#2e7d32", label: "GOOD SPOT",         hint: "Nothing meaningful in the way." },
  partial: { color: "#fbc02d", label: "PARTIALLY BLOCKED", hint: "You'll see some of it." },
  blocked: { color: "#d32f2f", label: "BLOCKED",           hint: "Something's in the way." },
  poor:    { color: "#7e57c2", label: "BAD ANGLE",         hint: "Too close, too far, or too low." },
};

function verdictFor(profile) {
  if (!profile) return null;
  const { frac, category } = profile;
  if (category === "poor-angle") return VERDICT.poor;
  if (frac >= 0.85) return VERDICT.good;
  if (frac >= 0.15) return VERDICT.partial;
  return VERDICT.blocked;
}

function bearingDeg(from, to) {
  const φ1 = (from.lat * Math.PI) / 180;
  const φ2 = (to.lat * Math.PI) / 180;
  const Δλ = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

function cardinal(deg) {
  const c = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return c[Math.round(deg / 45) % 8];
}

export default function MobileHere() {
  const gps = useMyLocation({ auto: true });

  // Show pick — nearest known preset by proximity. MVP: no date match.
  const show = useMemo(() => {
    if (gps.status !== "ok") return null;
    return pickNearestShow(gps.coord);
  }, [gps.status, gps.coord?.lat, gps.coord?.lng]);

  // Analysis result: { profile, error?, loading }
  const [analysis, setAnalysis] = useState({ loading: false });

  useEffect(() => {
    if (gps.status !== "ok" || !show) return undefined;
    let cancelled = false;
    setAnalysis({ loading: true });

    (async () => {
      try {
        const observer = gps.coord;
        const launch = { lat: show.preset.lat, lng: show.preset.lng };
        const caliber = show.preset.caliber ?? 8;
        const { targetHeight, shellRadius } = deriveShellParams(caliber);

        // Pull the Overture buildings pmtiles URL from the STAC catalog
        // — same source the desktop /map uses. No MapView needs to be
        // mounted; the loader is standalone. Returns a Map keyed by
        // catalog id (buildings/base/transportation/…).
        const pmtilesUrls = await loadPmtilesFromStac();
        const buildingsUrl = pmtilesUrls?.get?.("buildings") ?? pmtilesUrls?.buildings;
        if (!buildingsUrl) throw new Error("No buildings PMTiles URL from STAC");

        const [buildingsResult, terrainResult] = await Promise.all([
          loadBuildingsAlongCorridor({
            pmtilesUrl: buildingsUrl,
            from: observer,
            to: launch,
            bufferMeters: CORRIDOR_BUFFER_METERS,
          }),
          loadElevationGridForCorridor({ from: observer, to: launch, bufferMeters: 200 }),
        ]);
        // Both loaders return richer structures than "just the payload":
        // buildings has {buildings, coverageGaps} and terrain has
        // {grid, missingTiles}. Downstream computeSightlineProfile only
        // needs the array + the grid instance.
        const buildings = buildingsResult?.buildings ?? [];
        const terrainGrid = terrainResult?.grid ?? null;
        if (cancelled) return;

        const profile = computeSightlineProfile({
          observer, launch,
          targetHeight, shellRadius,
          buildings, terrainGrid,
        });
        if (cancelled) return;

        setAnalysis({ loading: false, profile, observer, launch, show: show.preset });
      } catch (err) {
        if (cancelled) return;
        setAnalysis({ loading: false, error: String(err?.message || err) });
      }
    })();

    return () => { cancelled = true; };
  }, [gps.status, gps.coord?.lat, gps.coord?.lng, show]);

  // Nominatim refine — same pattern as LocationChip, but the mobile
  // page reads location up front so we duplicate the wiring here for
  // the top of the card.
  const [locInfo, setLocInfo] = useState(null);
  useEffect(() => {
    if (gps.status !== "ok") { setLocInfo(null); return undefined; }
    // No map instance available on this route — describeLocation needs
    // rendered features. Skip local, go straight to Nominatim.
    setLocInfo({ primary: `${gps.coord.lat.toFixed(5)}, ${gps.coord.lng.toFixed(5)}`, source: "coords",
                 gmapsUrl: `https://www.google.com/maps?q=${gps.coord.lat.toFixed(6)},${gps.coord.lng.toFixed(6)}` });
    let cancelled = false;
    refineWithNominatim(gps.coord).then((r) => {
      if (!cancelled && r) setLocInfo(r);
    });
    return () => { cancelled = true; };
  }, [gps.status, gps.coord?.lat, gps.coord?.lng]);

  // ---- render ------------------------------------------------------
  const isPortrait = true; // MVP: mobile-first

  const wrap = {
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column",
    padding: 3,
    gap: 3,
    backgroundColor: "#fafafa",
    fontFamily: "Montserrat, sans-serif",
  };

  if (gps.status === "loading") {
    return (
      <Box sx={wrap}>
        <Header />
        <Center>
          <CircularProgress size={32} />
          <Typography sx={{ mt: 2 }}>Finding your location…</Typography>
        </Center>
      </Box>
    );
  }
  if (gps.status === "denied") {
    return (
      <Box sx={wrap}>
        <Header />
        <Center>
          <Typography variant="h6" sx={{ mb: 1 }}>Location blocked</Typography>
          <Typography variant="body2" sx={{ mb: 3, color: "text.secondary", textAlign: "center" }}>
            VANTAGE needs your location to tell you if this spot has a clear view of the show.
            Enable location in your browser settings, or plan on the full map.
          </Typography>
          <Button href="/map" variant="outlined">Open the full map</Button>
        </Center>
      </Box>
    );
  }
  if (gps.status === "unavailable" || gps.status === "timeout") {
    return (
      <Box sx={wrap}>
        <Header />
        <Center>
          <Typography variant="h6" sx={{ mb: 1 }}>Can't get GPS</Typography>
          <Typography variant="body2" sx={{ mb: 3, color: "text.secondary", textAlign: "center" }}>
            {gps.error || "Try again outdoors, or plan on the full map."}
          </Typography>
          <Button href="/map" variant="outlined">Open the full map</Button>
        </Center>
      </Box>
    );
  }

  if (!show) {
    // GPS ok but not near any known show
    return (
      <Box sx={wrap}>
        <Header />
        <Center>
          <Typography variant="h6" sx={{ mb: 1 }}>No known show nearby</Typography>
          <Typography variant="body2" sx={{ mb: 3, color: "text.secondary", textAlign: "center" }}>
            You're more than 100 km from any preset we know about. Open the full map to pick a
            launch point manually.
          </Typography>
          <Button href="/map" variant="outlined">Open the full map</Button>
        </Center>
      </Box>
    );
  }

  const v = verdictFor(analysis.profile);
  const distanceKm = analysis.profile
    ? (analysis.profile.totalDistance / 1000)
    : show.distanceKm;
  const bearing = analysis.observer && analysis.launch
    ? bearingDeg(analysis.observer, analysis.launch)
    : null;

  return (
    <Box sx={wrap}>
      <Header showName={show.preset.name} />

      {/* Verdict card — the primary answer, huge on the screen */}
      <Box
        sx={{
          padding: 3,
          borderRadius: 3,
          backgroundColor: v ? `${v.color}12` : "#eee",
          border: v ? `2px solid ${v.color}` : "1px solid #ccc",
          textAlign: "center",
        }}
      >
        {analysis.loading && (
          <>
            <CircularProgress size={28} />
            <Typography variant="body2" sx={{ mt: 2, color: "text.secondary" }}>
              Checking the sightline to {show.preset.name}…
            </Typography>
          </>
        )}
        {!analysis.loading && analysis.error && (
          <>
            <Typography variant="h6" sx={{ color: "error.main", mb: 1 }}>Analysis failed</Typography>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>{analysis.error}</Typography>
          </>
        )}
        {!analysis.loading && v && (
          <>
            <Typography sx={{ fontSize: 44, fontWeight: 800, color: v.color, lineHeight: 1.1 }}>
              {v.label}
            </Typography>
            <Typography sx={{ fontSize: 16, color: "text.secondary", mt: 1 }}>
              {v.hint}
            </Typography>
            {analysis.profile.frac < 1 && analysis.profile.frac > 0 && (
              <Typography sx={{ fontSize: 14, color: "text.secondary", mt: 0.5 }}>
                {Math.round(analysis.profile.frac * 100)}% of the shell would clear
              </Typography>
            )}
          </>
        )}
      </Box>

      {/* Where you are */}
      {locInfo && (
        <Stack spacing={0.5}>
          <Typography variant="overline" sx={{ color: "text.secondary" }}>You&apos;re at</Typography>
          <Typography sx={{ fontWeight: 600, fontSize: 16 }}>📍 {locInfo.primary}</Typography>
          {locInfo.secondary && (
            <Typography variant="caption" sx={{ color: "text.secondary" }}>{locInfo.secondary}</Typography>
          )}
          <Link href={locInfo.gmapsUrl} target="_blank" rel="noopener noreferrer" sx={{ fontSize: 13, mt: 0.5 }}>
            Open in Google Maps ↗
          </Link>
        </Stack>
      )}

      {/* Bearing + distance to launch */}
      {bearing != null && (
        <Stack spacing={0.5}>
          <Typography variant="overline" sx={{ color: "text.secondary" }}>Look this way</Typography>
          <Typography sx={{ fontWeight: 600, fontSize: 20 }}>
            → {cardinal(bearing)} ({Math.round(bearing)}°)
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {distanceKm >= 1 ? `${distanceKm.toFixed(1)} km` : `${Math.round(distanceKm * 1000)} m`} from {show.preset.name}
          </Typography>
        </Stack>
      )}

      {/* Escape hatches */}
      <Stack spacing={1} sx={{ mt: "auto", pb: 2 }}>
        <Button
          fullWidth
          variant="outlined"
          href={buildDetailsUrl(analysis)}
        >
          Show details on full map
        </Button>
        <Button
          fullWidth
          size="small"
          variant="text"
          sx={{ color: "text.secondary", fontSize: 12 }}
          href={buildFeedbackMailto(analysis, v, locInfo)}
        >
          Something wrong? Send feedback
        </Button>
      </Stack>
    </Box>
  );
}

function Header({ showName }) {
  return (
    <Stack direction="row" alignItems="baseline" justifyContent="space-between">
      <Typography sx={{ fontWeight: 800, fontSize: 22, letterSpacing: 1 }}>VANTAGE</Typography>
      {showName && (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {showName}
        </Typography>
      )}
    </Stack>
  );
}

function Center({ children }) {
  return (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      {children}
    </Box>
  );
}

/**
 * Build a `mailto:` link with the analysis context pre-populated so a
 * beta tester's feedback arrives with everything the maintainer needs
 * to reproduce (version, verdict, coords, device UA, error if any).
 *
 * Falls back to a plain empty body when the feedback email isn't
 * configured — the link is still safe to render, just won't route
 * to a real inbox.
 */
function buildFeedbackMailto(analysis, verdict, locInfo) {
  const email = process.env.NEXT_PUBLIC_FEEDBACK_EMAIL || "feedback@example.com";
  const sha = (process.env.NEXT_PUBLIC_GIT_SHA || "dev").slice(0, 8);
  const url = typeof window !== "undefined" ? window.location.href : "";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const parts = [
    "What went wrong (please describe):",
    "",
    "",
    "-- auto-attached context, ok to keep --",
    `version: ${sha}`,
    `page: ${url}`,
    `verdict: ${verdict?.label || "n/a"}`,
    analysis?.profile
      ? `frac: ${analysis.profile.frac.toFixed(3)}  category: ${analysis.profile.category}`
      : "(no analysis yet)",
    analysis?.observer
      ? `observer: ${analysis.observer.lat.toFixed(5)}, ${analysis.observer.lng.toFixed(5)}`
      : "",
    analysis?.launch
      ? `launch: ${analysis.launch.lat.toFixed(5)}, ${analysis.launch.lng.toFixed(5)}`
      : "",
    analysis?.show ? `show: ${analysis.show.name}` : "",
    locInfo?.primary ? `where: ${locInfo.primary}` : "",
    `ua: ${ua}`,
  ].filter(Boolean).join("\n");
  const subject = `VANTAGE beta feedback (v${sha})`;
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(parts)}`;
}

function buildDetailsUrl(analysis) {
  const params = new URLSearchParams();
  if (analysis.launch) {
    params.set("launch", `${analysis.launch.lat.toFixed(6)},${analysis.launch.lng.toFixed(6)}`);
  }
  if (analysis.observer) {
    params.set("observer", `${analysis.observer.lat.toFixed(6)},${analysis.observer.lng.toFixed(6)}`);
  }
  if (analysis.show?.caliber) params.set("caliber", String(analysis.show.caliber));
  const zoom = analysis.show?.zoom ?? 14;
  const centerLat = analysis.launch?.lat ?? 40.7;
  const centerLng = analysis.launch?.lng ?? -74;
  return `/map?${params.toString()}#${zoom}/${centerLat.toFixed(4)}/${centerLng.toFixed(4)}`;
}

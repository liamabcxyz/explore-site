// Top-level assembler for the "Report a problem" bundle. Splits cleanly
// into three input streams:
//
//   1. auto-captured app state (analysis snapshot, perf, fetch trace,
//      env fingerprint, build identity)
//   2. user-provided context (free-text description, expected result,
//      "anything else")
//   3. on-map annotations (0–3 pins the user placed to flag specific
//      buildings / spots)
//
// The output is JSON-safe so downstream callers can copy to clipboard,
// download as a .json file, POST to a future server, or attach to a
// bug tracker — one shape, many transports.

import { buildSightlineDebugReport } from "@/lib/viewshed/debugReport";
// Import from the small standalone state store, not stacService — the
// service pulls in stac-js at module top and Jest chokes on that ESM
// package via this import chain (bundle → dialog → ProfilePanel tests).
import { getPinnedReleaseId, getPinnedReleaseUrl } from "@/lib/stacReleaseState";
import { getLatestViewshedPerf } from "@/lib/perf";
import { getFetchTrace } from "@/lib/debug/trace";

function captureRuntime() {
  if (typeof window === "undefined") return {};
  return {
    userAgent: navigator?.userAgent ?? null,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    devicePixelRatio: window.devicePixelRatio ?? null,
    timezone: Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone ?? null,
    language: navigator?.language ?? null,
    colorScheme: window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light",
    online: typeof navigator?.onLine === "boolean" ? navigator.onLine : null,
  };
}

function captureApp() {
  return {
    // NEXT_PUBLIC_* env is baked in at build time (see next.config.mjs).
    // Fallbacks keep the bundle valid when the dev is running from a
    // config that pre-dated the env additions.
    gitSha: process.env.NEXT_PUBLIC_GIT_SHA ?? "unknown",
    builtAt: process.env.NEXT_PUBLIC_BUILD_TIME ?? "unknown",
    basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
    // Kept even though it's static — makes the JSON self-describing to a
    // developer opening it cold ("what app is this from?").
    name: "vantage",
  };
}

// Strip building footprints out of the analysis snapshot — a large SF
// analysis has hundreds of hits and each footprint is dozens of coords;
// the bundle is meant to be pastable and downloadable, not archival. The
// centroid + name + height + confidence is what a debugging developer
// needs to correlate against their own analysis.
function compactHits(hits) {
  return (hits ?? []).map((h) => {
    const ring = h?.footprint?.[0];
    let centroid = null;
    if (ring && ring.length > 0) {
      const verts = ring.slice(0, -1);
      let sumLng = 0;
      let sumLat = 0;
      for (const [lng, lat] of verts) {
        sumLng += lng;
        sumLat += lat;
      }
      centroid = { lat: sumLat / verts.length, lng: sumLng / verts.length };
    }
    return {
      name: h.name ?? null,
      distance: h.distance,
      height: h.height,
      confidence: h.confidence,
      req: h.req,
      centroid,
    };
  });
}

// The whole terrain profile is nice for the text report but big for the
// JSON blob — downsample to at most 60 samples along the sightline.
function compactTerrain(terrain) {
  if (!Array.isArray(terrain) || terrain.length === 0) return [];
  const maxN = 60;
  if (terrain.length <= maxN) return terrain;
  const step = Math.ceil(terrain.length / maxN);
  const out = [];
  for (let i = 0; i < terrain.length; i += step) out.push(terrain[i]);
  const last = terrain[terrain.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function compactAnalysis(analysis) {
  if (!analysis) return null;
  const {
    launch, observer, targetHeight, shellRadius, caliber, observerBuilding,
    profile, mode, buildingsConsidered, analysisRadiusMeters, corridorBufferMeters,
  } = analysis;
  return {
    launch,
    observer,
    caliber,
    targetHeight,
    shellRadius,
    observerBuilding: observerBuilding
      ? { ...observerBuilding, footprint: undefined }
      : null,
    mode,
    buildingsConsidered,
    analysisRadiusMeters,
    corridorBufferMeters,
    profile: profile
      ? {
          ...profile,
          hits: compactHits(profile.hits),
          terrainProfile: compactTerrain(profile.terrainProfile),
        }
      : null,
  };
}

/**
 * @param {object} args
 * @param {object} args.analysis - the LaunchContext analysis object
 * @param {{mode:string,floor:number}} [args.viewerLevel]
 * @param {{description:string,expected:string|null,extraContext:string}} [args.user]
 * @param {Array} [args.annotations]
 * @returns {object} the report bundle, JSON-safe
 */
export function buildReportBundle({ analysis, viewerLevel, user, annotations } = {}) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    app: captureApp(),
    runtime: captureRuntime(),
    reproUrl: typeof window !== "undefined" ? window.location.href : null,
    stac: {
      releaseId: getPinnedReleaseId(),
      releaseUrl: getPinnedReleaseUrl(),
    },
    user: {
      description: user?.description ?? "",
      expected: user?.expected ?? null,
      extraContext: user?.extraContext ?? "",
    },
    annotations: annotations ?? [],
    analysis: compactAnalysis(analysis),
    perf: getLatestViewshedPerf(),
    fetchTrace: getFetchTrace(),
    // The old plain-text human-readable report stays available for a
    // developer who wants to skim without opening a JSON viewer.
    textReport: analysis?.profile
      ? buildSightlineDebugReport(analysis, viewerLevel)
      : null,
  };
}

/**
 * Serialize + hand off. Right now: clipboard by default, download as a
 * file when the caller asks. Later, when there's a real transport
 * (email / server POST), swap the body without touching callers.
 */
export async function sendReport(bundle, { mode = "clipboard" } = {}) {
  const json = JSON.stringify(bundle, null, 2);
  if (mode === "download") {
    if (typeof document === "undefined") throw new Error("no document — cannot download");
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vantage-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }
  if (typeof navigator?.clipboard?.writeText !== "function") {
    throw new Error("clipboard unavailable — try downloading instead");
  }
  await navigator.clipboard.writeText(json);
}

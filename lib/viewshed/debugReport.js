/**
 * Human-readable dump of one sightline computation, meant to be copied out
 * of the app and pasted into a bug report / chat — every number that feeds
 * fractionVisible/score gets its own labeled line plus a short note on what
 * it means and where it came from, so a reader with no access to this
 * codebase can still spot which input looks wrong. See scoring.js for the
 * formulas this narrates (fractionVisible, elevationAngleDeg,
 * apparentAngularDiameterDeg, visibilityCategory) and computeProfile.js for
 * how observerAbsAlt/targetAbsAlt/minAlt are derived.
 */

const CONFIDENCE_NOTE = {
  high: "height is directly reported for this building",
  medium: "height is estimated from floor count or community-sourced data",
  low: "height is a rough class-based default — no real data for this building",
};

function fmt(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return "n/a";
  if (!Number.isFinite(n)) return n > 0 ? "+Infinity" : "-Infinity";
  return n.toFixed(digits);
}

function fmtLatLng(p) {
  return p ? `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}` : "n/a";
}

function fmtDistance(m) {
  if (!Number.isFinite(m)) return "n/a";
  return m >= 1000 ? `${(m / 1000).toFixed(3)}km (${Math.round(m)}m)` : `${Math.round(m)}m`;
}

function stanceDescription(observerBuilding, viewerLevel) {
  if (!observerBuilding) return "ground level (not standing on a mapped building)";
  const mode = viewerLevel?.mode ?? "ground";
  if (mode === "rooftop") {
    return `rooftop of "${observerBuilding.name ?? "(unnamed building)"}" (~${Math.round(observerBuilding.height)}m tall)`;
  }
  if (mode === "floor") {
    const floor = Math.min(Math.max(1, viewerLevel?.floor ?? 1), observerBuilding.maxFloors);
    return `floor ${floor} of ${observerBuilding.maxFloors} in "${observerBuilding.name ?? "(unnamed building)"}" (~${Math.round(observerBuilding.height)}m tall)`;
  }
  return `ground level, standing next to/on "${observerBuilding.name ?? "(unnamed building)"}" but not using its height`;
}

// Centroid of a hit's first ring — enough to locate the building on a map
// without dumping every footprint vertex into the report.
function centroidOf(footprint) {
  const ring = footprint?.[0];
  if (!ring || ring.length === 0) return null;
  const verts = ring.slice(0, -1);
  let sumLng = 0;
  let sumLat = 0;
  for (const [lng, lat] of verts) {
    sumLng += lng;
    sumLat += lat;
  }
  return { lat: sumLat / verts.length, lng: sumLng / verts.length };
}

function downsample(points, maxPoints) {
  if (points.length <= maxPoints) return { points, step: 1, originalCount: points.length };
  const step = Math.ceil(points.length / maxPoints);
  const sampled = [];
  for (let i = 0; i < points.length; i += step) sampled.push(points[i]);
  const last = points[points.length - 1];
  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  return { points: sampled, step, originalCount: points.length };
}

/**
 * @param {object} analysis - the LaunchContext `analysis` object: at minimum
 *   { launch, observer, targetHeight, shellRadius, caliber, observerBuilding,
 *     profile, mode, buildingsConsidered, analysisRadiusMeters, corridorBufferMeters }
 * @param {{mode:string,floor:number}} [viewerLevel]
 * @returns {string} plain-text report
 */
export function buildSightlineDebugReport(analysis, viewerLevel) {
  const lines = [];
  const p = (s = "") => lines.push(s);

  if (!analysis?.profile || !analysis.observer || !analysis.launch) {
    return "No sightline computed yet — place both a launch point and a viewing spot first.";
  }

  const { launch, observer, caliber, targetHeight, shellRadius, observerBuilding, profile, mode, buildingsConsidered, analysisRadiusMeters, corridorBufferMeters } = analysis;
  const {
    totalDistance, eyeHeight, observerAbsAlt, targetAbsAlt, targetApparentAlt,
    observerGroundElev, launchElev, minAlt, frac, theta, phi, score, category,
    hits, terrainProfile, coverageGaps, dataIncomplete,
  } = profile;

  p("=".repeat(72));
  p("VANTAGE SIGHTLINE DEBUG REPORT");
  p(`Generated: ${new Date().toISOString()}`);
  p("=".repeat(72));
  p();

  // --- Mode ---------------------------------------------------------------
  p("--- FETCH MODE ---");
  if (mode === "corridor") {
    p(`corridor — the viewing spot is more than ${analysisRadiusMeters ?? 1500}m from the launch`);
    p(`point (measured: ${fmtDistance(totalDistance)}), so buildings were fetched directly`);
    p(`from the PMTiles building archive along a ${corridorBufferMeters ?? 200}m-wide strip`);
    p("centered on the straight line between the two points, rather than from");
    p("whatever's already loaded in the visible map viewport.");
  } else {
    p(`grid — the viewing spot is within ${analysisRadiusMeters ?? 1500}m of the launch point`);
    p(`(measured: ${fmtDistance(totalDistance)}), so buildings came from the map's already-`);
    p("loaded vector source (the same data backing the on-screen heat-map grid).");
  }
  p();

  // --- Inputs ---------------------------------------------------------------
  p("--- INPUTS ---");
  p(`Caliber: ${caliber}" shell -> burst height ${fmt(targetHeight, 1)}m above launch ground, shell radius ${fmt(shellRadius, 1)}m`);
  p(`Launch point (lat, lng): ${fmtLatLng(launch)}`);
  p(`Viewing spot (lat, lng): ${fmtLatLng(observer)}`);
  p(`Ground distance launch<->viewing spot: ${fmtDistance(totalDistance)}`);
  p(`Viewing spot stance: ${stanceDescription(observerBuilding, viewerLevel)}`);
  p(`  -> eye height used above that stance's base: ${fmt(eyeHeight, 2)}m`);
  if (observerBuilding && observerBuilding.confidence !== "high") {
    p(`  -> building height confidence: ${observerBuilding.confidence} (${CONFIDENCE_NOTE[observerBuilding.confidence] ?? "n/a"})`);
  }
  p();

  // --- Elevation / curvature --------------------------------------------
  p("--- ELEVATION & EARTH CURVATURE ---");
  p(`Launch ground elevation (ASL, from terrain tiles or 0 if unavailable): ${fmt(launchElev, 1)}m`);
  p(`Viewing spot ground elevation (ASL): ${fmt(observerGroundElev, 1)}m`);
  p(`Viewing spot eye altitude (ASL) = ground elev + stance height = ${fmt(observerGroundElev, 1)} + ${fmt(eyeHeight, 2)} = ${fmt(observerAbsAlt, 1)}m`);
  p(`Launch target altitude (ASL) = launch ground elev + burst height = ${fmt(launchElev, 1)} + ${fmt(targetHeight, 1)} = ${fmt(targetAbsAlt, 1)}m`);
  const curvatureApplied = totalDistance >= 2000;
  p(`Earth curvature / refraction correction applied: ${curvatureApplied ? "yes" : "no"} (only kicks in >= 2000m; this line is ${fmtDistance(totalDistance)})`);
  if (curvatureApplied) {
    p(`  -> target's apparent altitude after curvature drop: ${fmt(targetApparentAlt, 1)}m (raw ${fmt(targetAbsAlt, 1)}m minus ${fmt(targetAbsAlt - targetApparentAlt, 1)}m drop)`);
  } else {
    p(`  -> target's apparent altitude (no correction at this range): ${fmt(targetApparentAlt, 1)}m`);
  }
  p();

  // --- Buildings ----------------------------------------------------------
  p("--- BUILDINGS ---");
  p(`Total building footprints handed to the intersection test: ${buildingsConsidered ?? "n/a"}`);
  p(`Of those, footprints the observer->launch line actually crosses ("hits"): ${hits.length}`);
  if (hits.length === 0) {
    p("  (no buildings intersect this line — any blockage below comes from terrain, not buildings)");
  } else {
    p();
    p("  Sorted by distance from the viewing spot. \"req\" is the target altitude");
    p("  (meters ASL, curvature-corrected) this building's roofline projects to");
    p("  at the launch point's distance — if the target's apparent altitude is");
    p("  BELOW a hit's req, that building blocks the shot at that height.");
    p();
    hits.forEach((h, i) => {
      const centroid = centroidOf(h.footprint);
      p(`  ${i + 1}. "${h.name ?? "(unnamed)"}" — ${fmtDistance(h.distance)} from viewing spot`);
      p(`     height: ${fmt(h.height, 1)}m ASL (confidence: ${h.confidence} — ${CONFIDENCE_NOTE[h.confidence] ?? "n/a"})`);
      p(`     req (altitude target must clear): ${fmt(h.req, 1)}m`);
      if (centroid) p(`     centroid (lat, lng): ${fmtLatLng(centroid)}`);
    });
  }
  p();

  // --- Terrain profile ------------------------------------------------------
  p("--- TERRAIN PROFILE ---");
  if (!terrainProfile || terrainProfile.length === 0) {
    p("No terrain samples (totalDistance was 0 or no terrain grid was available).");
  } else {
    const elevations = terrainProfile.map((s) => s.elevation);
    const minElev = Math.min(...elevations);
    const maxElev = Math.max(...elevations);
    p(`${terrainProfile.length} samples along the line (nominally every 20m), elevation range ${fmt(minElev, 1)}m to ${fmt(maxElev, 1)}m ASL.`);
    p(`At viewing spot (d=0): ${fmt(terrainProfile[0].elevation, 1)}m. At launch (d=${fmtDistance(terrainProfile[terrainProfile.length - 1].distance)}): ${fmt(terrainProfile[terrainProfile.length - 1].elevation, 1)}m.`);
    const buildingsMaxReq = hits.length > 0 ? Math.max(...hits.map((h) => h.req)) : -Infinity;
    const terrainIsBinding = minAlt > buildingsMaxReq + 1e-6;
    p(`Binding constraint on minAlt: ${terrainIsBinding ? "terrain (ground itself), not a building" : hits.length > 0 ? "a building (see hit list above)" : "none — line is geometrically clear"}`);
    const { points: sampled, step, originalCount } = downsample(terrainProfile, 120);
    if (step > 1) {
      p(`(showing every ${step}th sample, ${sampled.length} of ${originalCount} points, to keep this report a reasonable size)`);
    }
    p("distance_m, elevation_m_ASL");
    for (const s of sampled) p(`${Math.round(s.distance)}, ${fmt(s.elevation, 1)}`);
  }
  p();

  // --- Data completeness ----------------------------------------------------
  p("--- DATA COMPLETENESS ---");
  p(`dataIncomplete: ${dataIncomplete} (true means some stretch of the line could NOT be checked)`);
  if (coverageGaps && coverageGaps.length > 0) {
    p("Coverage gaps (map/terrain tiles that failed to load along this line):");
    for (const g of coverageGaps) {
      p(`  - ${g.source}: from ${fmtDistance(g.fromMeters)} to ${fmtDistance(g.toMeters)} (could not be checked for obstacles)`);
    }
  } else {
    p("No coverage gaps — every tile the line crosses loaded successfully.");
  }
  p();

  // --- Result ---------------------------------------------------------------
  p("--- RESULT ---");
  p(`minAlt (the highest "req" among all buildings and terrain samples, i.e. the tallest obstruction): ${fmt(minAlt, 1)}m`);
  p(`targetApparentAlt (what the shell's altitude actually is, after curvature): ${fmt(targetApparentAlt, 1)}m`);
  const k = (minAlt - targetApparentAlt) / shellRadius;
  p(`k = (minAlt - targetApparentAlt) / shellRadius = (${fmt(minAlt, 1)} - ${fmt(targetApparentAlt, 1)}) / ${fmt(shellRadius, 1)} = ${fmt(k, 3)}`);
  p("  (k <= -1 -> fully visible, k >= 1 -> fully blocked, k=0 -> exactly half the shell clears)");
  p(`frac (fraction of the shell's disk above the obstruction): ${fmt(frac, 4)} (${Math.round(frac * 100)}%)`);
  p(`elevation angle to target (phi): ${fmt(phi, 2)}°`);
  p(`apparent angular diameter of the shell (theta): ${fmt(theta, 3)}°`);
  p(`composite score (frac x weather x angular-size-gate x elevation-comfort): ${fmt(score, 4)}`);
  p(`category: ${category} (blocked/poor-angle/partial/good — see lib/viewshed/scoring.js's visibilityCategory)`);
  p();

  p("--- RAW JSON (profile object, footprints stripped to centroids for size) ---");
  const compactHits = hits.map((h) => ({ ...h, footprint: undefined, centroid: centroidOf(h.footprint) }));
  const raw = {
    mode,
    caliber,
    targetHeight,
    shellRadius,
    launch,
    observer,
    observerBuilding: observerBuilding ? { ...observerBuilding, footprint: undefined } : null,
    viewerLevel,
    buildingsConsidered,
    ...profile,
    hits: compactHits,
    terrainProfile: undefined,
    terrainProfileNote: terrainProfile ? `${terrainProfile.length} samples omitted from JSON — see the table above` : null,
  };
  p(JSON.stringify(raw, null, 2));

  return lines.join("\n");
}

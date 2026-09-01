/**
 * Map GeoJSON for the observer→launch sightline overlay. Split at the
 * obstacle that drives minAlt (max req): green up to that point, red after.
 * The blocking building's footprint is a separate fill feature.
 *
 * Zero extra occlusion math — just restates profile.hits / minAlt.
 */
export function sightlineMapData({ observer, launch, profile }) {
  if (!observer || !launch || !profile || !(profile.totalDistance > 0)) {
    return {
      lines: { type: "FeatureCollection", features: [] },
      blocker: { type: "FeatureCollection", features: [] },
    };
  }

  const start = [observer.lng, observer.lat];
  const end = [launch.lng, launch.lat];
  const lerp = (t) => [
    start[0] + t * (end[0] - start[0]),
    start[1] + t * (end[1] - start[1]),
  ];

  const blockerHit = profile.hits.length > 0
    ? profile.hits.reduce((best, h) => (h.req >= best.req ? h : best), profile.hits[0])
    : null;
  const blocked = profile.frac < 1 && blockerHit && Number.isFinite(blockerHit.req);
  const splitT = blocked ? Math.min(1, Math.max(0, blockerHit.distance / profile.totalDistance)) : 1;
  const split = lerp(splitT);

  const lines = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { segment: "clear" },
        geometry: { type: "LineString", coordinates: [start, split] },
      },
    ],
  };
  if (blocked && splitT < 1) {
    lines.features.push({
      type: "Feature",
      properties: { segment: "blocked" },
      geometry: { type: "LineString", coordinates: [split, end] },
    });
  }

  const blocker = { type: "FeatureCollection", features: [] };
  if (blocked && blockerHit?.footprint) {
    blocker.features.push({
      type: "Feature",
      properties: { name: blockerHit.name || null },
      geometry: { type: "Polygon", coordinates: blockerHit.footprint },
    });
  }

  return { lines, blocker };
}

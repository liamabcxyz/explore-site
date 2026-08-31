import { makeLocalProjector } from "@/lib/geo/toLocalMeters";

/**
 * Turn computeViewshed's flat grid of ~2200 scored cells into a compact
 * "so where do I go?" list of top-N recommended viewing spots, spread
 * across the analysis area rather than clustered.
 *
 * A naive "sort by score, take top N" picks cells that are almost always
 * neighbors in the same sweet-spot band — three markers stacked on top of
 * each other tells the user nothing they didn't already read from the
 * color gradient. Instead, walk the score-sorted candidates greedily and
 * only accept each next pick if it sits at least `minSpreadMeters` from
 * every already-picked one. Spread guarantees the returned set covers
 * genuinely different vantage points.
 *
 * `minSpreadMeters` is measured on a local equirectangular projection
 * centered on the first pick (see lib/geo/toLocalMeters.js) — same
 * approximation the rest of the viewshed math uses, plenty accurate at
 * neighborhood scale.
 *
 * @param {Array<{properties: {score:number, sampleLat:number, sampleLng:number}}>} features
 *   the FeatureCollection.features array returned by computeViewshed
 * @param {number} [count=3]
 * @param {number} [minSpreadMeters=300]
 * @returns {Array<{rank:number, score:number, lat:number, lng:number}>}
 */
export function pickTopSpots(features, count = 3, minSpreadMeters = 300) {
  const withCoords = features.filter(
    (f) =>
      typeof f?.properties?.score === "number" &&
      typeof f?.properties?.sampleLat === "number" &&
      typeof f?.properties?.sampleLng === "number" &&
      f.properties.score > 0
  );
  if (withCoords.length === 0) return [];

  const sorted = [...withCoords].sort((a, b) => b.properties.score - a.properties.score);
  const first = sorted[0].properties;
  const projector = makeLocalProjector(first.sampleLat, first.sampleLng);

  const picks = [];
  const minSpreadSq = minSpreadMeters * minSpreadMeters;
  for (const feature of sorted) {
    if (picks.length >= count) break;
    const { sampleLat, sampleLng, score } = feature.properties;
    const { x, y } = projector.toLocal(sampleLat, sampleLng);
    const farEnough = picks.every((p) => {
      const dx = p.x - x;
      const dy = p.y - y;
      return dx * dx + dy * dy >= minSpreadSq;
    });
    if (!farEnough) continue;
    picks.push({ x, y, score, sampleLat, sampleLng });
  }

  return picks.map((p, i) => ({
    rank: i + 1,
    score: p.score,
    lat: p.sampleLat,
    lng: p.sampleLng,
  }));
}

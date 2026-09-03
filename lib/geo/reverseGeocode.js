// Best-effort "what's at this lat/lng." Two-phase:
//
//   Phase 1 — synchronous local resolve (`describeLocation`) walks
//   the Overture PMTiles the map has already loaded. No network, no
//   rate limits, works offline.
//
//   Phase 2 — optional async refine (`refineWithNominatim`) asks
//   OpenStreetMap's Nominatim reverse-geocode service for a real
//   door-numbered address when phase-1 only produced a "Near X
//   Street" style answer. Rate-limited at 1 req/s per IP by policy;
//   cached in-memory so accidental re-clicks don't re-fetch.
//
// Local priority chain, first hit wins:
//   1. Nearest place (POI) within 25 m — has a real postal address
//   2. Nearest two distinct road segments within 250 m — cross-street
//      pair "East 33rd St & 5th Ave" when both sit within 50 m of the
//      click, else "On {road}" (< 40 m) or "Near {road}" (up to 250 m)
//   3. Nothing recognizable close by — coord fallback only
//
// The `addresses::address` and `buildings::building` themes in the
// PMTiles you're pulling don't carry per-building door numbers today
// (probed on Manhattan across three zooms: 0/18363/0 features with
// address fields), so POIs are the only local door-number source.
// That's why Nominatim exists as the door-number fallback.

const METERS_PER_DEGREE_LAT = 111_320;

/**
 * Rough equirectangular distance in meters between two lat/lng points.
 * Accurate to within a few percent at city scale — plenty for
 * "which POI is closest to this click."
 */
function distanceMeters(a, b) {
  const dLat = (a.lat - b.lat) * METERS_PER_DEGREE_LAT;
  const dLng = (a.lng - b.lng) * METERS_PER_DEGREE_LAT
    * Math.cos((a.lat + b.lat) * 0.5 * Math.PI / 180);
  return Math.hypot(dLat, dLng);
}

/**
 * Point-to-linestring squared distance in local flat-meters. `points`
 * is a maplibre LineString `coordinates` array — [[lng,lat], ...].
 * Handles arbitrary vertex counts.
 */
function pointToLineDistanceMeters(pt, points) {
  if (!Array.isArray(points) || points.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    // Convert to meters relative to pt so hypot math is straightforward.
    const cosLat = Math.cos(pt.lat * Math.PI / 180);
    const ax = (a[0] - pt.lng) * METERS_PER_DEGREE_LAT * cosLat;
    const ay = (a[1] - pt.lat) * METERS_PER_DEGREE_LAT;
    const bx = (b[0] - pt.lng) * METERS_PER_DEGREE_LAT * cosLat;
    const by = (b[1] - pt.lat) * METERS_PER_DEGREE_LAT;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = Math.hypot(px, py);
    if (d < best) best = d;
  }
  return best;
}

/** Try `JSON.parse` on a string, return `fallback` on any failure. */
function safeJson(raw, fallback) {
  if (raw == null) return fallback;
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch { return fallback; }
}

/**
 * Get the display name for an Overture feature — prefers the resolved
 * `@name` field the tile server usually provides, falls back to
 * parsing the `names` JSON blob.
 */
function pickName(props) {
  if (!props) return null;
  if (typeof props["@name"] === "string" && props["@name"].trim()) return props["@name"];
  const names = safeJson(props.names, null);
  if (names?.primary) return names.primary;
  if (Array.isArray(names?.rules) && names.rules[0]?.value) return names.rules[0].value;
  return null;
}

const PLACE_MAX_METERS = 25;
// "On {street}" range — user is standing on that block. Beyond this,
// still useful info but the label softens to "Near {street}."
const ROAD_ON_METERS = 40;
// Fallback ceiling. At low zoom (~13) Overture's tile simplifier drops
// residential streets, leaving only arterials; the true nearest named
// road there can be 150-250 m away and reporting it is still more
// useful than pure coords. Above this, admit we don't know and fall
// back to coords.
const ROAD_MAX_METERS = 250;
// If two distinct-name roads both sit within this of the click, they
// most likely intersect — report as a cross-street pair.
const CROSS_STREET_METERS = 50;

/**
 * Reverse-geocode `{lat, lng}` against the loaded PMTiles.
 *
 * @param {maplibregl.Map} map - live map instance with sources loaded
 * @param {{lat:number, lng:number}} coord
 * @returns {{
 *   primary: string,
 *   secondary: string|null,
 *   source: "place"|"street"|"coords",
 *   gmapsUrl: string,
 * }}
 */
export function describeLocation(map, coord) {
  const { lat, lng } = coord;
  const gmapsUrl = `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;

  // 1) Nearest POI
  //
  // querySourceFeatures returns EVERY loaded feature in the source,
  // regardless of current viewport — that's exactly what we want for a
  // click that could be anywhere in the analysis radius, not just
  // dead-center on screen. City-scale POI density (~10k features per
  // zoom-14 tile on Manhattan) keeps the scan fast enough to run per
  // click.
  const placeSource = map.getSource("places");
  if (placeSource) {
    const feats = map.querySourceFeatures("places", { sourceLayer: "place" });
    let best = null;
    let bestDist = PLACE_MAX_METERS;
    for (const f of feats) {
      const g = f.geometry;
      if (!g || g.type !== "Point") continue;
      const d = distanceMeters(coord, { lng: g.coordinates[0], lat: g.coordinates[1] });
      if (d < bestDist) {
        bestDist = d;
        best = f;
      }
    }
    if (best) {
      const name = pickName(best.properties);
      const addresses = safeJson(best.properties?.addresses, []);
      const freeform = Array.isArray(addresses) && addresses[0]?.freeform
        ? addresses[0].freeform
        : null;
      if (name && freeform) {
        return { primary: name, secondary: freeform, source: "place", gmapsUrl };
      }
      if (name) return { primary: name, secondary: null, source: "place", gmapsUrl };
      if (freeform) return { primary: freeform, secondary: null, source: "place", gmapsUrl };
      // A place feature with neither name nor address — extremely rare;
      // fall through to street matching.
    }
  }

  // 2) Nearest road segment(s) — cross-streets if two distinct names sit
  //    close enough.
  const roadSource = map.getSource("transportation");
  if (roadSource) {
    const feats = map.querySourceFeatures("transportation", {
      sourceLayer: "segment",
      filter: ["==", ["get", "subtype"], "road"],
    });
    // Track two nearest by name so we get a cross-street pair. Same
    // road on both sides of a divided highway would double-count if we
    // took nearest-2 by feature; dedupe by street name instead.
    const byName = new Map(); // name -> min distance seen
    for (const f of feats) {
      const g = f.geometry;
      if (!g || g.type !== "LineString") continue;
      const name = pickName(f.properties);
      if (!name) continue;
      const d = pointToLineDistanceMeters(coord, g.coordinates);
      if (d > ROAD_MAX_METERS) continue;
      const cur = byName.get(name);
      if (cur == null || d < cur) byName.set(name, d);
    }
    if (byName.size >= 1) {
      const sorted = [...byName.entries()].sort((a, b) => a[1] - b[1]);
      const [n1, d1] = sorted[0];
      // Cross-street: two distinct roads BOTH within intersection range
      // of the click. "5th Ave & 42nd St" only fires when the pin
      // really is at (or very near) an intersection, so it doesn't
      // misfire as "Broadway & Some Alley" for a spot mid-block.
      if (sorted.length >= 2 && sorted[1][1] <= CROSS_STREET_METERS && d1 <= CROSS_STREET_METERS) {
        const [n2] = sorted[1];
        return { primary: `${n1} & ${n2}`, secondary: null, source: "street", gmapsUrl };
      }
      // Otherwise pick the closer of "On"/"Near" based on distance to
      // that one road. A ~200 m distance at low zoom is "the pin is
      // roughly near FDR Drive" — genuinely useful, but overstating it
      // as "On FDR Drive" would be misleading.
      const prefix = d1 <= ROAD_ON_METERS ? "On" : "Near";
      return { primary: `${prefix} ${n1}`, secondary: null, source: "street", gmapsUrl };
    }
  }

  // 3) Coord fallback — always shows something the user can copy/share.
  return {
    primary: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    secondary: null,
    source: "coords",
    gmapsUrl,
  };
}

/**
 * True when a local-resolve result is worth refining against Nominatim
 * for a door number. POI matches already carry a real address; only
 * street-fallback and coord-fallback results need external help.
 */
export function needsRefine(info) {
  return info != null && info.source !== "place";
}

// In-memory cache of pending / resolved Nominatim promises, keyed by
// coord rounded to 5 decimals (~1 m). Prevents duplicate fetches when
// the same point is queried twice (e.g. the observer point is also
// shown in a debug panel that reads location separately).
//
// Cleared only when the tab reloads — Nominatim's answer for a given
// coord is stable enough on the human timescale that we don't need to
// invalidate. Growth is bounded by "distinct coords the user clicks
// in one session" which is a handful.
const nominatimCache = new Map();

/**
 * OpenStreetMap Nominatim reverse-geocode. Returns the same shape as
 * `describeLocation` (`{primary, secondary, source, gmapsUrl}`) or
 * `null` on any failure (network, HTTP error, rate limit, malformed
 * response). Callers should treat a `null` return as "keep whatever
 * you had from `describeLocation`" — never as an error to surface.
 *
 * Rate policy: Nominatim's usage policy caps at 1 req/s per IP and
 * asks callers to identify themselves via User-Agent or Referer. The
 * browser's default User-Agent + Referer already identifies VANTAGE
 * as the caller. If this app ever gets popular enough to bump into
 * the rate cap, migrate to a self-hosted Nominatim or a paid
 * geocoding service — the shape of this function stays.
 *
 * https://operations.osmfoundation.org/policies/nominatim/
 */
export function refineWithNominatim(coord) {
  const { lat, lng } = coord;
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cached = nominatimCache.get(key);
  if (cached) return cached;

  const gmapsUrl = `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
  // zoom=18 asks for building-level detail; addressdetails=1 splits
  // the answer into structured components so we can pick "house
  // number + road" for primary and "neighborhood + postcode" for
  // secondary rather than reformat the flat display_name.
  const url =
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}` +
    `&format=jsonv2&addressdetails=1&zoom=18`;
  const p = fetch(url, { headers: { "Accept-Language": "en" } })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data || data.error) return null;
      const a = data.address ?? {};
      // Compose "house_number + road" when both are present, else fall
      // back to whichever component is most locative — road, or
      // enclosing area name for a park / bridge / plaza click.
      let primary = null;
      if (a.house_number && a.road) primary = `${a.house_number} ${a.road}`;
      else if (a.road) primary = a.road;
      else if (a.pedestrian) primary = a.pedestrian;
      else if (a.park || a.leisure) primary = a.park || a.leisure;
      else if (a.building) primary = a.building;
      else if (data.name) primary = data.name;
      if (!primary) return null;
      // "Neighborhood, City ZIP" — trim empties, join what remains.
      const neigh = a.neighbourhood || a.suburb || a.city_district;
      const city = a.city || a.town || a.village;
      const zip = a.postcode;
      const secondary = [neigh, [city, zip].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ") || null;
      return { primary, secondary, source: "nominatim", gmapsUrl };
    })
    .catch(() => null);
  nominatimCache.set(key, p);
  return p;
}

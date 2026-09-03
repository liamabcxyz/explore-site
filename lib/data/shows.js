// Small helper that answers "which known fireworks show is closest to
// this user right now?" — the mobile killer flow's auto-launch pick.
//
// MVP is proximity-only: no date matching (we don't know when the user
// visits), no time-of-day filter. If a user in San Francisco opens
// /here on a random Tuesday, they get Fisherman's Wharf as the default
// launch. That's a reasonable "if there were a show, this is probably
// which one" fallback. They can always override with ?launch=lat,lng.
//
// Date-aware picking (Bastille Day → Eiffel over the generic Paris
// preset) is a follow-up when we care enough to keep a calendar. Not
// today.

import { FIREWORKS_PRESETS } from "@/lib/fireworksPresets";

const METERS_PER_DEG_LAT = 111_320;
const MAX_MATCH_KM = 100;

function haversineKm(a, b) {
  const dLat = (a.lat - b.lat) * METERS_PER_DEG_LAT;
  const dLng = (a.lng - b.lng) * METERS_PER_DEG_LAT
    * Math.cos((a.lat + b.lat) * 0.5 * Math.PI / 180);
  return Math.hypot(dLat, dLng) / 1000;
}

/**
 * Nearest preset to `coord` within MAX_MATCH_KM. Returns the preset
 * object plus the computed distance so callers can label the pick
 * ("Macy's 4th of July — 3 km from you"). Returns `null` if the user
 * isn't near any known show — the mobile UI then prompts for a manual
 * pick from the full preset menu.
 */
export function pickNearestShow(coord) {
  if (!coord) return null;
  let best = null;
  let bestKm = MAX_MATCH_KM;
  for (const p of FIREWORKS_PRESETS) {
    const km = haversineKm(coord, { lat: p.lat, lng: p.lng });
    if (km < bestKm) {
      bestKm = km;
      best = p;
    }
  }
  return best ? { preset: best, distanceKm: bestKm } : null;
}

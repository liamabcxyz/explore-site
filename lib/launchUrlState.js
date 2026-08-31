import { STANDARD_CALIBERS_INCHES } from "@/lib/viewshed/caliber";

/**
 * Encode/decode the launch analysis state (launch point, caliber, observer
 * point, viewer level, rooftop-overlay toggle) into URL query params so a
 * user can share a link to a specific spot they found rather than a
 * screenshot. Maplibre-gl's own `hash: true` already persists the map's
 * center/zoom into the URL fragment; these functions only touch the search
 * string, so both survive a copy of the whole URL and neither owner
 * clobbers the other.
 *
 * All fields are optional — a URL with just `?launch=...` is valid (no
 * observer, no rooftop toggle); a URL with none of these params decodes to
 * an empty object and the app falls back to its normal defaults.
 *
 * Both functions are pure — no `window`, no history, no side effects. The
 * caller (components/launch/LaunchPointControl.jsx) is responsible for
 * reading `window.location.search`, calling replaceState, and guarding the
 * read for SSR.
 */

const COORD_DECIMALS = 5; // ~1m at NYC latitudes — enough for a spot, not
                          // enough to fingerprint anyone

function parseLatLng(value) {
  if (typeof value !== "string") return undefined;
  const parts = value.split(",");
  if (parts.length !== 2) return undefined;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return { lat, lng };
}

function formatLatLng({ lat, lng }) {
  return `${lat.toFixed(COORD_DECIMALS)},${lng.toFixed(COORD_DECIMALS)}`;
}

function parseCaliber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return STANDARD_CALIBERS_INCHES.includes(n) ? n : undefined;
}

function parseLevel(mode, floorRaw) {
  if (mode !== "ground" && mode !== "floor" && mode !== "rooftop") return undefined;
  if (mode !== "floor") return { mode, floor: 1 };
  const floor = Number(floorRaw);
  if (!Number.isFinite(floor) || floor < 1) return { mode, floor: 1 };
  return { mode, floor: Math.round(floor) };
}

export function parseLaunchUrlState(searchString) {
  const params = new URLSearchParams(searchString ?? "");
  return {
    launch: parseLatLng(params.get("launch")),
    caliber: parseCaliber(params.get("caliber")),
    observer: parseLatLng(params.get("observer")),
    viewerLevel: parseLevel(params.get("level"), params.get("floor")),
    showRooftopLayer: params.get("rooftop") === "1" ? true : undefined,
  };
}

/**
 * Merge launch state into an existing search string without touching keys
 * this module doesn't own (app/map/page.jsx writes its own `mode`/`feature`
 * keys — leaving those alone is what lets the two writers coexist).
 * Absent/falsy state fields → key removed, not written empty.
 */
export function writeLaunchUrlState(existingSearchString, state) {
  const params = new URLSearchParams(existingSearchString ?? "");
  const { launch, caliber, observer, viewerLevel, showRooftopLayer } = state;

  if (launch) params.set("launch", formatLatLng(launch));
  else params.delete("launch");

  if (typeof caliber === "number") params.set("caliber", String(caliber));
  else params.delete("caliber");

  if (observer) params.set("observer", formatLatLng(observer));
  else params.delete("observer");

  if (viewerLevel && viewerLevel.mode && viewerLevel.mode !== "ground") {
    params.set("level", viewerLevel.mode);
    if (viewerLevel.mode === "floor") params.set("floor", String(viewerLevel.floor));
    else params.delete("floor");
  } else {
    // Ground is the default — no need to spend a URL param on it.
    params.delete("level");
    params.delete("floor");
  }

  if (showRooftopLayer) params.set("rooftop", "1");
  else params.delete("rooftop");

  return params.toString();
}

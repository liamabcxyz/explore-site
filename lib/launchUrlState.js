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
  const presetRaw = params.get("preset");
  const stacRaw = params.get("stac");
  return {
    launch: parseLatLng(params.get("launch")),
    caliber: parseCaliber(params.get("caliber")),
    observer: parseLatLng(params.get("observer")),
    viewerLevel: parseLevel(params.get("level"), params.get("floor")),
    showRooftopLayer: params.get("rooftop") === "1" ? true : undefined,
    // Terrain hillshade toggle — visible-by-default is `false` (see
    // TerrainToggleControl); we only write "1" when the user turned it on.
    hillshadeOn: params.get("hs") === "1" ? true : undefined,
    // Preset id if the user loaded one from the presets menu. Informational
    // — the actual launch+caliber it drove are already captured. Kept
    // through a copy-share so the receiver can also see "the user was
    // looking at Macy's" rather than reverse-engineering it from coords.
    presetId: presetRaw && /^[a-z0-9-]{1,40}$/.test(presetRaw) ? presetRaw : undefined,
    // Overture STAC release id snapshotted at the moment the URL was
    // written. WRITE-only for now — the STAC pipeline still binds to
    // "latest" at read time (there's no code path yet that overrides the
    // catalog). Kept in the URL so a bug-report receiver can compare
    // against their own release and know if a mismatch might be why they
    // can't reproduce the exact numbers.
    stacRelease: stacRaw && /^[a-zA-Z0-9._-]{1,40}$/.test(stacRaw) ? stacRaw : undefined,
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
  const { launch, caliber, observer, viewerLevel, showRooftopLayer, hillshadeOn, presetId, stacRelease } = state;

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

  // hillshade off is the default; only spend a param when it's on.
  if (hillshadeOn) params.set("hs", "1");
  else params.delete("hs");

  if (presetId) params.set("preset", presetId);
  else params.delete("preset");

  if (stacRelease) params.set("stac", stacRelease);
  else params.delete("stac");

  return params.toString();
}

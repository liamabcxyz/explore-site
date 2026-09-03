"use client";

import { useEffect, useState } from "react";

/**
 * Wrapper around `navigator.geolocation.getCurrentPosition` with the
 * three UI states callers actually need to render:
 *
 *   - `status: "prompt"` — waiting on the browser's permission prompt
 *     (or the user has not clicked "Locate me" yet)
 *   - `status: "loading"` — request in flight
 *   - `status: "ok"` — `coord: {lat, lng}` is populated
 *   - `status: "denied"` / `"unavailable"` / `"timeout"` — surfaces the
 *     error class so the UI can show the right recovery text
 *
 * `enableHighAccuracy` is true by default because on phones we want
 * GPS-grade fixes (~5-15 m in city) — the killer mobile flow is
 * useless if the observer is 100 m off.
 */
export function useMyLocation({ auto = true } = {}) {
  const [state, setState] = useState({ status: auto ? "loading" : "prompt", coord: null });

  useEffect(() => {
    if (!auto) return undefined;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({ status: "unavailable", coord: null });
      return undefined;
    }
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        setState({
          status: "ok",
          coord: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        if (cancelled) return;
        const status =
          err.code === err.PERMISSION_DENIED ? "denied" :
          err.code === err.POSITION_UNAVAILABLE ? "unavailable" :
          err.code === err.TIMEOUT ? "timeout" : "unavailable";
        setState({ status, coord: null, error: err.message });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
    return () => { cancelled = true; };
  }, [auto]);

  const request = () => setState({ status: "loading", coord: null });

  return { ...state, request };
}

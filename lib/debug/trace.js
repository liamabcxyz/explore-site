// Ring-buffered log of network fetches VANTAGE makes for map/terrain
// data. There's no observable hook today — each of the three raw fetch
// sites (STAC catalog, Terrarium terrain tiles, corridor building tiles)
// only ever surfaces failures via console.warn — so a bug reporter who
// says "the app said 'blocked' but I can see the fireworks" leaves
// developers no way to check whether a tile silently failed and
// contributed to the wrong answer.
//
// `traceFetch(source, url, fetchImpl)` wraps a fetch call and records
// {source, url, status, ms, bytes, ok, error} into a bounded buffer.
// `getFetchTrace()` returns a defensive copy for snapshotting into the
// debug bundle (lib/debug/bundle.js). `clearFetchTrace()` is used by
// tests and by the "Report a problem" flow to give the report just the
// fetches that matter to the current sightline.
//
// Deliberately module-level state (not React context): the wrappers get
// called from workers, from map controls, from PMTiles internals — none
// of which have a natural React boundary. Bounded size keeps memory
// flat regardless of session length.

const MAX_ENTRIES = 200;
const buffer = [];

function push(entry) {
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
}

/**
 * Wrap a fetch invocation, capturing status/timing/byte-size. Any thrown
 * error is recorded and re-thrown so the caller's error handling doesn't
 * change.
 *
 * @param {string} source - freeform tag ("stac" | "terrarium" | "corridor-buildings")
 * @param {string} url
 * @param {() => Promise<Response>} fetchImpl - the actual fetch call; the
 *   wrapper doesn't invent one so a caller with custom headers/AbortSignal
 *   keeps control.
 * @returns {Promise<Response>}
 */
export async function traceFetch(source, url, fetchImpl) {
  const startedAt = (typeof performance !== "undefined" ? performance.now() : Date.now());
  try {
    const response = await fetchImpl();
    const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt;
    // Prefer Content-Length; fall back to unknown. We deliberately don't
    // .clone().arrayBuffer() the response just to measure size — that
    // would double memory pressure on 65KB terrain tiles for a diagnostic
    // that doesn't need exact bytes.
    const bytes = Number(response.headers?.get?.("content-length")) || null;
    push({ source, url, status: response.status, ok: response.ok, ms: Math.round(ms), bytes, at: new Date().toISOString() });
    return response;
  } catch (err) {
    const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt;
    push({ source, url, status: 0, ok: false, ms: Math.round(ms), bytes: null, error: String(err?.message ?? err), at: new Date().toISOString() });
    throw err;
  }
}

/**
 * Snapshot of the buffer contents. Defensive copy so a consumer can hold
 * onto the array without seeing later mutations.
 */
export function getFetchTrace() {
  return buffer.slice();
}

/** Empty the buffer. Called by tests and by the "Report a problem" flow. */
export function clearFetchTrace() {
  buffer.length = 0;
}

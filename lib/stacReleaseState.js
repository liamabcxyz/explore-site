// Tiny "what STAC release is the app currently bound to" store, extracted
// from stacService.js so debug/bundle.js can read it without transitively
// pulling in stac-js — stac-js is an ESM package that Jest's default
// transformer choked on when the ReportProblemDialog test path started
// importing bundle → stacService → stac-js.
//
// stacService.js writes here after each successful `loadStacData()`;
// consumers (currently: debug/bundle.js, LaunchPointControl's URL writer)
// read via getPinnedReleaseId / getPinnedReleaseUrl. Sync getters — the
// debug bundle isn't allowed to block on a network fetch.

let pinnedReleaseId = null;
let pinnedReleaseUrl = null;

export function setPinnedRelease({ releaseId, releaseUrl } = {}) {
  pinnedReleaseId = releaseId ?? null;
  pinnedReleaseUrl = releaseUrl ?? null;
}

export function getPinnedReleaseId() {
  return pinnedReleaseId;
}

export function getPinnedReleaseUrl() {
  return pinnedReleaseUrl;
}

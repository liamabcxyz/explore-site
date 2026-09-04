# Contributing to VANTAGE

## Pull requests

1. Fork the repo, create a branch from `main`.
2. If you've changed math or behavior, add or update jest tests.
3. `npm test` should be green; `npm run lint` should have no new
   warnings.
4. Keep commits focused. A commit that says "port foo to Rust" should
   not also refactor bar.
5. Open a PR against `main`.

## Working areas

Where the interesting code lives:

- **`lib/viewshed/`** — the JS reference implementation of the polar
  sweep, sightline profile, rooftop layer, scoring. Every function
  here has a Rust twin in `wasm/vantage-core/` that must produce
  byte-parity outputs. Change one, change the other, and run the
  worker's self-check (open devtools on `/map`, look for
  `[C5 wasm] self-check: bit-identical…`).
- **`wasm/vantage-core/`** — the Rust crate. `cargo test` in that
  directory runs the unit tests; `wasm-pack build --target bundler
  --release` from that directory rebuilds `pkg/` (which is checked in).
- **`components/mobile/`** — the `/here` view. Keep it lean; the
  killer scenario is a user with 10 seconds to check if this spot
  works.
- **`components/launch/`, `components/analysis/`** — the `/map`
  planning view. More surface area, more feature space.

## Testing conventions

- Unit tests co-located under `__tests__/` mirroring the source tree.
- Real Overture / terrain / Nominatim fetches are **not** mocked in
  tests — they run against fixtures under `__tests__/fixtures/`.
  If you add a new data path, add a fixture.
- Rust: `#[cfg(test)] mod tests { … }` at the bottom of each Rust
  file. Keep the Rust unit tests fast (single-digit ms). Cross-
  language parity happens in the JS worker's self-check, not
  in `cargo test`.

## Style

- No emoji in code or file names unless the user asked for one in a UI
  string. Prose comments and PR descriptions are fine.
- Don't add JS/TS comments that just restate the code — the "why"
  is what belongs in a comment.
- Don't reference the current task or PR in code comments; those
  belong in commit messages and rot fast.

## Adding a fireworks preset

Presets live in `lib/fireworksPresets.js`. Fields are documented at
the top of that file. Coordinates should be **approximate** —
Macy's alone rotates barges yearly — since VANTAGE analyses a spread
around the launch anyway.

## Lineage

VANTAGE was forked from
[Overture Explorer](https://github.com/OvertureMaps/explore-site).
Contributions to the Overture-related plumbing (base map, PMTiles
loading, layer specs) may also be worth sending upstream. The
fireworks-specific viewshed code is not upstream material.

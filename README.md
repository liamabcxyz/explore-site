<h1 align="center">VANTAGE</h1>

<p align="center">
  <em>Where can you actually see the fireworks from?</em>
</p>

VANTAGE is a browser-based line-of-sight analysis tool for fireworks
shows. Pick a launch point on the map, and it paints a radiating heat
map of what a real observer standing at each point around it would see
— accounting for the buildings and terrain between them and the burst.

There are two ways in:

- **`/map`** — the full planning view. Click to drop a launch point,
  see the polar visibility grid, click a viewing spot to see the
  full sightline breakdown (which buildings block, which terrain
  ridges matter, apparent size of the shell at that distance).

- **`/here`** — the mobile "am I at a good spot right now?" view.
  Grants location, picks the nearest known show, and shows a one-glance
  verdict (GOOD / PARTIALLY BLOCKED / BLOCKED / BAD ANGLE) plus the
  bearing to look and a Google Maps link.

## How it works

The visibility math is:

- **Ground data**: [Overture Maps](https://overturemaps.org/) building
  footprints + heights (via PMTiles), served with a MapLibre GL base
  map.
- **Terrain**: [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)
  in the Terrarium PNG encoding.
- **Compute**: A polar sector×ring sweep that projects every observer
  cell into local meters, walks the corridor to the launch point, and
  intersects each sightline against building footprints and terrain
  samples. Ported to Rust and compiled to WebAssembly — a Macy's-scale
  Manhattan analysis (~7 000 buildings, 2 220 cells) computes in
  ~110 ms per click; the JS reference for the same input takes
  ~5 seconds. See `wasm/vantage-core/` for the Rust crate.
- **Scoring**: Fraction of the shell visible + apparent-size gate +
  elevation-angle comfort, resolved into a discrete
  blocked / poor-angle / partial / good category. Colors on the map
  follow the category so a technically-clear-but-uncomfortable spot
  reads differently from a genuinely-obstructed one.

## Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [Rust + wasm-pack](https://rustwasm.github.io/wasm-pack/) if you
  want to rebuild the compute engine (a prebuilt `pkg/` ships in the
  repo, so day-to-day development doesn't require it)

## Getting started

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>.

Force the JS compute path (skips WASM entirely) with
`?impl=js`. Run both and diff cell-by-cell with `?impl=both` — the
worker logs a `[viewshed perf]` line every request with the
parity + timing verdict.

## Testing

```bash
npm test                # jest, currently 776 tests
npm run test:a11y       # accessibility tests
```

## Deploying

See [DEPLOY.md](DEPLOY.md) for the Cloudflare Pages walkthrough,
including the `/functions/api/log-error` Pages Function for
same-origin error collection.

## Project layout

- `app/` — Next.js routes: `/`, `/map`, `/here`
- `components/`
  - `mobile/` — the `/here` view
  - `launch/`, `analysis/` — the `/map` view
  - `map/` — MapLibre style tokens + layer specs
  - `shared/` — cross-route bits (ErrorBoundary, BetaBadge)
- `lib/`
  - `viewshed/` — JS compute pipeline + WASM glue
  - `geo/` — projector, corridor fetch, reverse-geocode
  - `data/` — presets + shows calendar
- `wasm/vantage-core/` — Rust compute crate (wasm-pack builds to `pkg/`)
- `functions/api/` — Cloudflare Pages Functions
- `__tests__/` — jest

## Acknowledgments

VANTAGE started as a fork of
[Overture Explorer](https://github.com/OvertureMaps/explore-site) and
inherits its Overture Maps data plumbing, MapLibre setup, and
component structure. The visibility-analysis half of the app —
`lib/viewshed/`, `lib/geo/`, `wasm/vantage-core/`, everything in
`/here` and `/map`'s launch/analysis panels — is written for
VANTAGE.

The `LICENSE.md` retains Overture Maps Foundation's original MIT
copyright as required by that license, alongside a modifications
notice for the VANTAGE work.

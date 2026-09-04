# Changelog

## 0.1.0-beta — 2026-09-04

Initial beta release.

**Fireworks visibility analysis**
- Polar sector×ring viewshed grid around a launch point
- Sightline profile for any observer→launch pair
- Per-building rooftop visibility layer
- Real-world fireworks presets (Macy's, Sydney Harbour, London NYE,
  Bastille Day, Boston Pops, and more)

**Two ways in**
- `/map` — full desktop planning view
- `/here` — mobile-native "am I at a good spot right now?" view with
  GPS auto-locate, address lookup via Nominatim, bearing to launch,
  and a Google Maps escape hatch

**Compute engine**
- Rust + WebAssembly implementation of the full compute pipeline
  (`wasm/vantage-core/`). A Macy's-scale Manhattan analysis
  (~7 000 buildings, 2 220 cells) computes in ~110 ms; the JS
  reference for the same input takes ~5 seconds.
- URL switch `?impl=js|wasm|both` for A/B and parity checking.
  Bit-identical (~1e-15) results across 29 cross-language checks.

**Base map**
- Overture Maps buildings + transportation + places, via PMTiles
- AWS Terrain Tiles (Terrarium PNG) for elevation
- Rebalanced Overture Explorer's daylight palette so water reads as
  water and parks pop from land
- Ferry routes rendered as dashed blue lines so they don't look like
  roads

**Beta safety net**
- BETA badge visible on every page with the deployed git SHA
- ErrorBoundary + errorReport with pluggable sinks (console,
  webhook, optional Sentry)
- `noindex, nofollow` while under beta
- `/functions/api/log-error` — same-origin Cloudflare Pages Function
  for error collection with optional Discord push

## Lineage

VANTAGE started as a fork of
[Overture Explorer](https://github.com/OvertureMaps/explore-site).
The Overture base-map plumbing, PMTiles loading, MapLibre setup,
and component structure come from that fork; the fireworks
visibility analysis was written for VANTAGE.

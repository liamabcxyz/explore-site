# Deployment (Cloudflare Pages)

VANTAGE is a Next.js static-export site. Cloudflare Pages hosts the
static assets and — optionally — runs the small `/functions/**`
Workers for same-origin API endpoints. No Node server needed.

## First-time setup

1. **Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect
   to Git.** Pick the `explore-site` repo, `main` branch.
2. **Build configuration**:
   - Framework preset: **Next.js (Static HTML Export)**
   - Build command: `npm run build`
   - Build output directory: `out`
   - Root directory: (leave blank)
3. **Environment variables** — see the table below. Set for both
   Production and Preview environments (or a subset if you only want
   them on prod).
4. **Save & Deploy.** First build takes ~3-5 min; subsequent builds
   are faster due to CF's cache.
5. **Custom domain** (optional, later): Pages project → Custom
   domains → Add. CF handles DNS + HTTPS automatically for domains
   already in your CF account.

## Environment variables

All `NEXT_PUBLIC_*` vars are **build-time** — they get inlined into
the client bundle by Next.js at `npm run build`, not read at runtime.
Change them → rebuild.

| Variable | Default | What it does |
|---|---|---|
| `NEXT_PUBLIC_ALLOW_INDEX` | (unset) | `true` removes the `noindex` meta tag. Delete `public/robots.txt` at the same time. |
| `NEXT_PUBLIC_HIDE_BETA_BADGE` | (unset) | `true` hides the orange BETA chip. Set when the site graduates from beta. |
| `NEXT_PUBLIC_FEEDBACK_EMAIL` | `vantagespots+feedback@gmail.com` | Destination for the "Send feedback" mailto links. |
| `NEXT_PUBLIC_ERROR_WEBHOOK_URL` | (unset) | Where uncaught errors get POSTed. For Cloudflare Pages, use `/api/log-error` (same-origin — no CORS, no external service). |
| `NEXT_PUBLIC_SENTRY_DSN` | (unset) | If set AND `@sentry/browser` is `npm install`ed, errors also go to Sentry. Optional. |

Function-side env vars (runtime — for `/functions/api/log-error.js`,
set on the Pages project, NOT prefixed with `NEXT_PUBLIC_`):

| Variable | What it does |
|---|---|
| `DISCORD_WEBHOOK_URL` | If set, `/api/log-error` also POSTs a summary to Discord for real-time push notifications on your phone. Optional. |

## Recommended first-deploy env var set

```
NEXT_PUBLIC_FEEDBACK_EMAIL=vantagespots+feedback@gmail.com   # or your inbox
NEXT_PUBLIC_ERROR_WEBHOOK_URL=/api/log-error                 # same-origin Pages Function
```

That's it. Everything else has sensible defaults for beta.

## Verifying the deploy

After `pages.dev` URL is live:

1. **Landing page loads** at `https://<your>.pages.dev/`.
2. **Map works** at `/map` — pick a launch point, see the polar
   heatmap and top-3 pins.
3. **WASM path works** — the URL you land on defaults to
   `?impl=wasm`. Open devtools console; look for a
   `[viewshed perf]` line showing `impl=wasm | … ms` after your
   first analysis.
4. **/here works** — open on a phone (or DevTools mobile view + fake
   geolocation), grant location, see the verdict card.
5. **noindex meta** — view source, confirm `<meta name="robots"
   content="noindex, nofollow">` is present.
6. **BETA badge** — orange chip visible bottom-right on every page.
7. **Error endpoint** — open `https://<your>.pages.dev/api/log-error`
   in a browser; should return `ok` (200). GET works as an "is it
   alive" check.
8. **Real error round-trip** — devtools console, run
   `throw new Error("test-from-console")`. Then check Pages project
   → Functions → Logs (real-time tail); a JSON envelope with your
   message should appear within a few seconds.

## Ongoing

- **Preview deploys per PR** — enabled by default. Every branch push
  gets a `<branch>.<project>.pages.dev` URL. Great for testing UI
  changes on your actual phone before merging.
- **Log retention** — Cloudflare Pages Logs are short-term (~a few
  hours real-time tail). For durable error archive, add a KV or D1
  binding to `/functions/api/log-error.js` and write there too. Not
  needed for beta.
- **When you're ready to leave beta** — set `NEXT_PUBLIC_ALLOW_INDEX=true`
  and `NEXT_PUBLIC_HIDE_BETA_BADGE=true`, delete `public/robots.txt`,
  rebuild. Reversible if beta feedback tells you it's not quite ready.

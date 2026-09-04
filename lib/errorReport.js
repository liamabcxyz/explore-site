// Central error reporter — plug in Sentry / GlitchTip / a custom
// webhook via env vars, no code change. Beta rollout uses this to
// catch every uncaught error + unhandled promise rejection + React
// component crash and ship them somewhere the maintainer can see,
// without waiting on the user to file a report.
//
// Configuration (build-time, all NEXT_PUBLIC_):
//   NEXT_PUBLIC_SENTRY_DSN         — if set, load @sentry/browser on
//                                    demand and forward errors there.
//                                    Package not installed by default;
//                                    the dynamic import fails silently
//                                    when the DSN is set but the pkg
//                                    isn't, and we fall through to
//                                    the webhook / console path.
//   NEXT_PUBLIC_ERROR_WEBHOOK_URL  — if set, POST a compact JSON
//                                    envelope with the error + basic
//                                    context. Fits Cloudflare Worker /
//                                    Formspree / webhook.site targets.
//
// If neither is set, errors go to console.error (still useful in
// devtools) but nothing leaves the browser.

const SENTRY_DSN = typeof process !== "undefined"
  ? process.env.NEXT_PUBLIC_SENTRY_DSN
  : undefined;
const WEBHOOK_URL = typeof process !== "undefined"
  ? process.env.NEXT_PUBLIC_ERROR_WEBHOOK_URL
  : undefined;
const GIT_SHA = typeof process !== "undefined"
  ? process.env.NEXT_PUBLIC_GIT_SHA
  : undefined;
const BUILD_TIME = typeof process !== "undefined"
  ? process.env.NEXT_PUBLIC_BUILD_TIME
  : undefined;

let sentryPromise = null;
function loadSentry() {
  if (!SENTRY_DSN) return Promise.resolve(null);
  if (sentryPromise) return sentryPromise;
  sentryPromise = import(/* webpackIgnore: true */ "@sentry/browser")
    .then((mod) => {
      mod.init({
        dsn: SENTRY_DSN,
        release: GIT_SHA,
        environment: "beta",
        // Keep breadcrumb noise low; the errors themselves carry
        // enough context via our own `ctx` field.
        maxBreadcrumbs: 20,
      });
      return mod;
    })
    .catch(() => null); // pkg not installed — silently drop
  return sentryPromise;
}

// Basic guard so a burst of the same error doesn't spam the webhook.
// Not deduping semantically — just rate-limiting so a runaway effect
// doesn't fire 60 times per second.
const seen = new Map();
const DEDUP_MS = 5000;
function shouldReport(key) {
  const now = Date.now();
  const last = seen.get(key);
  if (last && now - last < DEDUP_MS) return false;
  seen.set(key, now);
  return true;
}

/**
 * Report an error to whatever sinks are configured. Always
 * console.error's first so devtools users see it in the usual place.
 *
 * @param {unknown} err  the caught exception; strings/objects also OK
 * @param {object} [ctx] extra tags: `{source, location, viewerLevel, ...}`
 */
export function reportError(err, ctx = {}) {
  // eslint-disable-next-line no-console
  console.error("[vantage error]", err, ctx);

  const message = err?.message ?? String(err);
  const stack = err?.stack ?? null;
  const key = `${message}::${ctx.source ?? "unknown"}`;
  if (!shouldReport(key)) return;

  // Sentry path — its own SDK handles batching, retries, etc.
  if (SENTRY_DSN) {
    loadSentry().then((sentry) => {
      if (!sentry) return;
      sentry.withScope((scope) => {
        for (const [k, v] of Object.entries(ctx)) scope.setTag(k, String(v));
        sentry.captureException(err instanceof Error ? err : new Error(message));
      });
    });
  }

  // Webhook path — fire-and-forget, no await, no throw.
  if (WEBHOOK_URL && typeof fetch !== "undefined") {
    try {
      const envelope = {
        message,
        stack,
        ctx,
        version: GIT_SHA,
        builtAt: BUILD_TIME,
        url: typeof window !== "undefined" ? window.location.href : null,
        ua: typeof navigator !== "undefined" ? navigator.userAgent : null,
        ts: new Date().toISOString(),
      };
      // `keepalive: true` lets the request finish even if the tab is
      // unloading — critical for catching crashes on navigation.
      fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Never let reporting itself throw and hide the original error.
    }
  }
}

/**
 * Install `error` + `unhandledrejection` listeners on `window` so
 * every otherwise-uncaught exception routes through reportError.
 * Idempotent — safe to call multiple times. No-op on server.
 */
let installed = false;
export function installGlobalErrorHandlers() {
  if (typeof window === "undefined" || installed) return;
  installed = true;
  window.addEventListener("error", (event) => {
    reportError(event.error ?? new Error(event.message), {
      source: "window.error",
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportError(reason instanceof Error ? reason : new Error(String(reason)), {
      source: "unhandledrejection",
    });
  });
}

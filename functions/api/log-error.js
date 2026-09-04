// Cloudflare Pages Function — same-origin error-reporting endpoint.
// URL after deploy: https://<your-domain>/api/log-error
//
// Runtime is Cloudflare Workers (not Node): only web-standard
// Request/Response/fetch are available. No `require`, no `fs`, no
// stream. Bindings arrive as `context.env`; secrets get set in the
// Pages dashboard under Settings → Environment Variables (Production
// / Preview) and are opaque strings here.
//
// Configuration (optional, set as env vars in the Pages dashboard):
//   DISCORD_WEBHOOK_URL — if set, a compact summary is POSTed to
//     Discord for a real-time push notification on your phone.
//     Failure to reach Discord is intentionally swallowed so the
//     browser still sees a 204.
//   MIN_LEVEL — "error" (default) or "warn". Reserved; today we
//     accept everything.
//
// Storage: Cloudflare Logs collect every console.log automatically.
// View them at Dashboard → your Pages project → Functions → Logs
// (real-time tail) OR `npx wrangler pages deployment tail --project-name=<name>`.
// Retention is short (a few hours) — this is a beta observability
// aid, not durable audit storage. Add a KV or D1 sink here when
// that need appears.

const CORS_HEADERS = {
  // Same-origin in normal use (the browser hits /api/log-error on the
  // same host as the page), but * is safe here — the endpoint doesn't
  // return data, doesn't read cookies, doesn't touch user records;
  // the worst an attacker can do is pollute your logs, which we'd
  // rate-limit at the edge if it ever matters.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let payload = null;
  try {
    payload = await request.json();
  } catch {
    // Non-JSON body — accept as opaque text so we don't drop a report
    // just because the client couldn't serialize.
    try { payload = { raw: (await request.text()).slice(0, 4000) }; } catch { payload = null; }
  }
  if (!payload) return new Response(null, { status: 204, headers: CORS_HEADERS });

  // A bit of provenance the client can't spoof. `cf` is Cloudflare's
  // request enrichment; safe fields only (no IP), useful for
  // "which region are errors coming from."
  const cf = request.cf || {};
  const meta = {
    country: cf.country ?? null,
    city: cf.city ?? null,
    colo: cf.colo ?? null,
    receivedAt: new Date().toISOString(),
    ua: request.headers.get("user-agent") ?? null,
    referer: request.headers.get("referer") ?? null,
  };
  // console.log at info level lands in Pages Logs. Structured JSON so
  // future log-drain / D1 export sees a stable schema.
  console.log(JSON.stringify({ type: "vantage_error", meta, payload }));

  // Optional Discord push. Wrapped so a Discord outage never fails
  // the client's report — we only care that OUR log captured it.
  const discordUrl = env?.DISCORD_WEBHOOK_URL;
  if (discordUrl) {
    const msg = formatDiscord(payload, meta);
    // Fire-and-forget so the response returns in <50ms. Cloudflare's
    // `waitUntil` extends the worker's lifetime past the response.
    context.waitUntil(
      fetch(discordUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: msg }),
      }).catch(() => {}),
    );
  }

  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// GET is handy for a manual "is this endpoint alive" check from
// browser address bar or curl. Returns 200 with no body.
export async function onRequestGet() {
  return new Response("ok", {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "text/plain" },
  });
}

// ------- helpers --------------------------------------------------------

function formatDiscord(payload, meta) {
  const version = (payload.version || "?").slice(0, 12);
  const url = (payload.url || "?").slice(0, 160);
  const message = (payload.message || "unknown error").slice(0, 300);
  const source = payload.ctx?.source ?? "unknown";
  const stack = (payload.stack || "").split("\n").slice(0, 8).join("\n").slice(0, 1400);
  const geo = [meta.city, meta.country].filter(Boolean).join(", ") || "?";
  const lines = [
    `🔴 **${message}**`,
    `\`v${version}\`  ·  \`${source}\`  ·  ${geo}`,
    url,
  ];
  if (stack) lines.push("```", stack, "```");
  // Discord content limit is 2000; splitting into embeds would give
  // more room but this stays intentionally simple.
  return lines.join("\n").slice(0, 1950);
}

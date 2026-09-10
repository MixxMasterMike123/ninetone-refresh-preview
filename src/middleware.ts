/**
 * Tiered edge-cache middleware — the "really good cache engine" from
 * docs/cms-architecture.md, in one route→TTL table.
 *
 * Flow per GET request (cf target only — inert in Node, where there is no
 * Cache API):
 *
 *   1. Read the cache VERSION from KV (bumped by the Publish button —
 *      src/pages/api/publish.ts). The version is part of every cache key,
 *      so bumping it instantly invalidates the whole site without a
 *      Cloudflare-API purge token.
 *   2. Look up `v<version>:<path>` in the edge cache → serve on hit (~ms).
 *   3. On miss, render the page (FM reads go through src/lib/cache.ts,
 *      so even a burst of misses costs at most one FM call per query per
 *      60s per isolate), stamp tiered Cache-Control, and store the copy
 *      via cfContext.waitUntil so the visitor never waits on the write.
 *
 * Content-aware TTLs: different content changes at different rates. One
 * flat timeout would either hammer FM (too short) or feel stale (too
 * long). Tiers per the architecture doc:
 *
 *   homepage 5min · news 15min · detail pages 1h · rosters 6h · team 24h
 *
 * `stale-while-revalidate` is included for the production domain, where
 * Cloudflare's CDN honors it; the Worker-level Cache API simply expires.
 *

 * Cache keys embed BOTH invalidation signals:
 *   - the KV version epoch (content: Publish button)
 *   - the per-build id (code: every deploy starts a fresh generation)
 * Verified live on workers.dev — x-cache: hit serves in ~20ms.
 */

import { defineMiddleware } from "astro:middleware";
import { getCfEnv } from "./lib/cf";
import {
  edgeCacheKey,
  legacyPreviousArtistTarget,
  shouldBypassCache,
  trailingSlashRedirectTarget,
} from "./lib/cache-policy";

// Statically replaced by Vite (astro.config define); guarded for any context
// where the define isn't applied.
declare const __BUILD_ID__: string | undefined;
const BUILD_ID = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";

/** First match wins — order specific → general. Seconds. */
const TTL_RULES: Array<[RegExp, number]> = [
  [/^\/$/, 300], // homepage — promo bar + featured rotate often
  [/^\/search-index\.json$/, 900], // command palette / search data
  [/^\/news(\/|$)/, 900], // news index + articles
  [/^\/team(\/|$)/, 86400], // changes a few times a year
  [/^\/integritet(\/|$)/, 86400], // static legal copy
  [/^\/(records|management|ninetone-nation)\/?$/, 21600], // section landings
  [/^\/records\/artists\/?$/, 21600], // roster lists
  [/^\/management\/clients\/?$/, 21600],
  [/^\/ninetone-nation\/booking\/?$/, 21600],
  [/^\/records\/artists\/previous\/single\//, 3600], // previous-artist detail
  [/^\/records\/artists\/previous(\/|$)/, 21600], // previous roster (paginated)
  [/^\/records\/artists\//, 3600], // artist detail
  [/^\/management\/clients\//, 3600], // client detail
  [/^\/ninetone-nation\//, 3600], // nation detail + contact
];
const DEFAULT_TTL = 3600;

function ttlFor(pathname: string): number {
  for (const [re, ttl] of TTL_RULES) {
    if (re.test(pathname)) return ttl;
  }
  return DEFAULT_TTL;
}

function harden(res: Response): Response {
  // Some platform responses expose immutable headers; clone before applying
  // policy so redirects/errors receive the same protection reliably.
  res = new Response(res.body, res);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.headers.set("Content-Security-Policy", "base-uri 'self'; object-src 'none'; frame-ancestors 'none'");
  res.headers.set("Strict-Transport-Security", "max-age=31536000");
  return res;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url, locals } = context;

  // Trailing-slash canonicalization (seo-phase-1b-brief.md P0 item 5) — the
  // cf target's astro.config.mjs now sets trailingSlash: "never", so
  // "/path/" is never the shape Astro itself renders. Redirect ahead of the
  // cache lookup: it must return immediately without ever reaching the
  // cache read/buffer/store cycle below. trailingSlashRedirectTarget()
  // already exempts "/" and reuses cache-policy's own SKIP list (/api/*,
  // /admin, /404) rather than a second hardcoded exemption list.
  const redirectTarget = trailingSlashRedirectTarget(url.pathname);
  if (redirectTarget) {
    const location = `${redirectTarget}${url.search}`;
    return harden(new Response(null, { status: 301, headers: { Location: location } }));
  }

  // Legacy previous-artist deep links (seo-phase-1b-brief.md P0 item 2).
  //
  // BACKSTOP, not the live path on cf. Verified on staging: these URLs are
  // answered by the Cloudflare static-asset layer from public/_redirects —
  // the response carries public/_headers' fingerprint (max-age=600,
  // x-robots-tag) rather than this middleware's (x-cache, tiered s-maxage) —
  // so the code below does not run there. It exists for any request that does
  // reach the Worker, and it is what the unit tests exercise.
  //
  // Not in astro.config.mjs's `redirects` because the Cloudflare adapter
  // writes those into _redirects with an "/index.html" suffix on dynamic
  // destinations, which 404s on an SSR Worker, and corrected duplicates are
  // rejected ("Duplicate rule for path").
  //
  // Keep in sync with public/_redirects, including the "single" listing guard.
  const legacyPrevious = legacyPreviousArtistTarget(url.pathname);
  if (legacyPrevious) {
    const location = `${legacyPrevious}${url.search}`;
    return harden(new Response(null, { status: 301, headers: { Location: location } }));
  }

  const cacheApi = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (!cacheApi || shouldBypassCache(request, url.pathname, url.search)) {
    return harden(await next());
  }

  const env = await getCfEnv();
  if (!env) return harden(await next()); // Node runtime (static build / plain dev)

  // Publish-button epoch. KV read is edge-cached 60s, so a Publish takes
  // effect within ~a minute per colo — and costs ~nothing per request.
  let version = "0";
  try {
    version = (await env.CACHE_STATE?.get("cache-version", { cacheTtl: 60 })) ?? "0";
  } catch {
    // KV unavailable → still cache, just without instant purge.
  }

  const ttl = ttlFor(url.pathname);
  // Include the request origin so Host-dependent SSR output cannot cross hosts.
  const cacheKey = new Request(edgeCacheKey(url.origin, url.pathname, version, BUILD_ID));

  const hit = await cacheApi.match(cacheKey);
  if (hit) {
    const res = new Response(hit.body, hit);
    res.headers.set("x-cache", "hit");
    return harden(res);
  }

  // Clone immediately: platform-generated redirects can expose immutable
  // Headers, while the cache decision needs to annotate every response.
  const rendered = await next();
  const res = new Response(rendered.body, rendered);

  // Only cache successful full responses — a transient error page must never
  // be pinned at the edge for an hour.
  const responseCacheControl = res.headers.get("cache-control") ?? "";
  if (
    res.status !== 200 ||
    res.headers.has("set-cookie") ||
    /(?:^|,)\s*(?:private|no-store|no-cache)\b/i.test(responseCacheControl)
  ) {
    res.headers.set("x-cache", "bypass");
    return harden(res);
  }

  // Browser gets a short lease (60s), the edge holds the tiered TTL, and the
  // production CDN may serve stale while it revalidates in the background.
  res.headers.set(
    "Cache-Control",
    `public, max-age=60, s-maxage=${ttl}, stale-while-revalidate=${ttl}`,
  );
  res.headers.set("x-cache", "miss");
  res.headers.set("x-cache-ttl", String(ttl));

  // Buffer the body before caching rather than res.clone().
  //
  // Astro streams its HTML. clone() tees that single stream into two branches
  // which must be consumed at roughly the same rate: one goes to the visitor,
  // the other to cacheApi.put(). When the visitor's branch finishes first the
  // renderer is still writing into the cache branch, and the runtime throws
  //   ResponseSentError: The response has already been sent to the browser
  //   and cannot be altered.
  // from BufferedRenderer.flush — which aborts the render mid-stream and
  // hands the visitor a ZERO-BYTE 200. Captured via `wrangler tail`:
  // 3/3 requests to a heavy detail page threw exactly this
  // (docs/seo-phase-1b-brief.md P0 items 1 and 3 are the same defect).
  //
  // Reading the body to completion first costs one buffer of the page, and
  // these are HTML documents, not large assets. Both the visitor's response
  // and the cached copy are then built from the same settled bytes, so
  // neither can race the other.
  const body = await res.arrayBuffer();
  const forVisitor = new Response(body, res);
  const forCache = new Response(body, res);

  const store = cacheApi.put(cacheKey, forCache);
  // Never let the cache write block the visitor's response; fall back to
  // inline await if the execution context isn't exposed for some reason.
  const cfContext = (locals as { cfContext?: { waitUntil(p: Promise<unknown>): void } }).cfContext;
  if (cfContext?.waitUntil) {
    cfContext.waitUntil(store.catch((err) => console.error("[edge-cache] put failed:", err)));
  } else {
    await store.catch((err) => console.error("[edge-cache] put failed:", err));
  }

  return harden(forVisitor);
});

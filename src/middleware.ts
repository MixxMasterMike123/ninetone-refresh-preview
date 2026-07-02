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

/** Never edge-cache these. */
const SKIP = [/^\/api\//, /^\/admin(\/|$)/];

function ttlFor(pathname: string): number {
  for (const [re, ttl] of TTL_RULES) {
    if (re.test(pathname)) return ttl;
  }
  return DEFAULT_TTL;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url, locals } = context;

  const cacheApi = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (!cacheApi || request.method !== "GET" || SKIP.some((re) => re.test(url.pathname))) {
    return next();
  }

  const env = await getCfEnv();
  if (!env) return next(); // Node runtime (static build / plain dev)

  // Publish-button epoch. KV read is edge-cached 60s, so a Publish takes
  // effect within ~a minute per colo — and costs ~nothing per request.
  let version = "0";
  try {
    version = (await env.CACHE_STATE?.get("cache-version", { cacheTtl: 60 })) ?? "0";
  } catch {
    // KV unavailable → still cache, just without instant purge.
  }

  const ttl = ttlFor(url.pathname);
  // Cache keys must be requests; the host is arbitrary but must be stable.
  const cacheKey = new Request(
    `https://edge-cache.ninetone.internal/v${version}/b${BUILD_ID}${url.pathname}${url.search}`,
  );

  const hit = await cacheApi.match(cacheKey);
  if (hit) {
    const res = new Response(hit.body, hit);
    res.headers.set("x-cache", "hit");
    return res;
  }

  const res = await next();

  // Only cache successful full responses — a transient error page must never
  // be pinned at the edge for an hour.
  if (res.status !== 200 || res.headers.has("set-cookie")) {
    res.headers.set("x-cache", "bypass");
    return res;
  }

  // Browser gets a short lease (60s), the edge holds the tiered TTL, and the
  // production CDN may serve stale while it revalidates in the background.
  res.headers.set(
    "Cache-Control",
    `public, max-age=60, s-maxage=${ttl}, stale-while-revalidate=${ttl}`,
  );
  res.headers.set("x-cache", "miss");
  res.headers.set("x-cache-ttl", String(ttl));

  const store = cacheApi.put(cacheKey, res.clone());
  // Never let the cache write block the visitor's response; fall back to
  // inline await if the execution context isn't exposed for some reason.
  const cfContext = (locals as { cfContext?: { waitUntil(p: Promise<unknown>): void } }).cfContext;
  if (cfContext?.waitUntil) {
    cfContext.waitUntil(store.catch((err) => console.error("[edge-cache] put failed:", err)));
  } else {
    await store.catch((err) => console.error("[edge-cache] put failed:", err));
  }

  return res;
});

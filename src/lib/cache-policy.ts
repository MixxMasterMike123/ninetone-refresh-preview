// /404 is skipped for a subtler reason than /api and /admin: Astro.rewrite()
// (used by every detail route on a failed lookup) re-invokes this ENTIRE
// middleware — including this module — a second, nested time for the
// rewritten pathname, before returning control to the page that called it.
// That inner pass used to run the full cache read -> clone -> store cycle
// against the SAME response stream the outer pass would then read again to
// finish handling the original URL. A ReadableStream can only be consumed
// once; teeing it via `res.clone()` in the inner pass left the outer pass
// racing an already-locked-or-drained stream, which is what produced the
// intermittent zero-byte bodies on 404s (see docs/seo-phase-1b-brief.md P0
// item 1, Cause A). Bypassing the cache entirely for /404 means the inner
// pass does a single clean `harden(await next())` with no clone/tee, so the
// outer pass always receives a fully-formed body to hand back to the client.
const SKIP = [/^\/api\//, /^\/admin(\/|$)/, /^\/404(\/|$)/];

/**
 * Query params that never change page content — safe to ignore for cache
 * purposes so campaign links (?utm_*, ?fbclid=...) still hit the shared cache
 * instead of missing on every unique click-through.
 */
const IGNORABLE_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "fbclid", "gclid", "gbraid", "wbraid", "ttclid", "msclkid", "mc_cid", "mc_eid", "ref",
]);

/**
 * Reduce a request's query string to what actually affects the response.
 * Returns "" when every param is an ignorable tracking param (or there are
 * none), or null when any other param is present — callers should treat
 * null as "bypass, this may vary the response".
 */
export function canonicalSearch(search: string): string | null {
  if (search === "") return "";
  const params = new URLSearchParams(search);
  for (const key of params.keys()) {
    if (!IGNORABLE_PARAMS.has(key)) return null;
  }
  return "";
}

/**
 * The site sets no session/auth cookies, so a cookie header alone is not a
 * signal of private content — analytics cookies (_ga, _fbp, _ttp) set after
 * consent would otherwise make every repeat visitor miss the shared cache.
 * Response-side checks (private/no-store/no-cache, Set-Cookie, non-200,
 * /api and /admin skips) protect any future private route instead.
 */
export function shouldBypassCache(request: Request, pathname: string, search: string): boolean {
  return request.method !== "GET" || request.headers.has("authorization") ||
    canonicalSearch(search) === null || SKIP.some((re) => re.test(pathname));
}

export function edgeCacheKey(origin: string, pathname: string, version: string, buildId: string): string {
  return `https://edge-cache.ninetone.internal/v${version}/b${buildId}/o${encodeURIComponent(origin)}${pathname}`;
}

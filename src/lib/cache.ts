/**
 * In-memory cache for FM/Shopify/YouTube reads, shared by both runtimes:
 *
 *  - Static build (GH Pages preview): one process, exits when done. The TTL
 *    barely matters — the win is in-flight dedup, so redundant list calls
 *    (`getArtists` from a list page AND getStaticPaths) collapse to one
 *    network round-trip.
 *  - Cloudflare Worker (server output): the isolate lives for many requests.
 *    Here the TTL is load-bearing — without it, the first render would pin
 *    its data forever and the site would never refresh. 60s keeps every
 *    isolate near-fresh while the edge cache (src/middleware.ts) absorbs
 *    almost all traffic in front of this layer.
 *
 * Stale-on-error: when a refresh fails and we have a previously-good value,
 * serve that and retry shortly — an FM hiccup shouldn't 500 a page that
 * rendered fine a minute ago. A failure with NO previous value still throws
 * (better a loud error than caching an empty site).
 *
 * Token requests are deliberately NOT cached here — auth flow stays live.
 */

const TTL_MS = 60_000;
const RETRY_AFTER_ERROR_MS = 30_000;

type Entry = {
  promise: Promise<unknown>;
  expires: number;
  /** Last successfully resolved value — served if a later refresh fails. */
  stale?: { value: unknown };
};

const memCache = new Map<string, Entry>();

function key(namespace: string, payload: unknown): string {
  return `${namespace}:${JSON.stringify(payload)}`;
}

/**
 * Cache a fetch by (namespace, payload). Concurrent callers share the
 * in-flight Promise; the value is reused until the TTL lapses.
 */
export function cached<T>(
  namespace: string,
  payload: unknown,
  loader: () => Promise<T>,
  ttlMs: number = TTL_MS,
): Promise<T> {
  const k = key(namespace, payload);
  const now = Date.now();
  const existing = memCache.get(k);
  if (existing && now < existing.expires) return existing.promise as Promise<T>;

  const entry: Entry = {
    promise: Promise.resolve() as Promise<unknown>,
    expires: now + ttlMs,
    stale: existing?.stale,
  };
  entry.promise = loader().then(
    (value) => {
      entry.stale = { value };
      return value;
    },
    (err) => {
      if (entry.stale) {
        console.error(`[cache] ${namespace} refresh failed — serving stale value:`, err);
        entry.expires = Date.now() + RETRY_AFTER_ERROR_MS;
        return entry.stale.value as T;
      }
      memCache.delete(k);
      throw err;
    },
  );
  memCache.set(k, entry);
  return entry.promise as Promise<T>;
}

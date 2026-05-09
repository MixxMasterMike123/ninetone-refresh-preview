/**
 * In-memory cache for build-time API responses (FileMaker, Shopify).
 *
 * Same-process repeats share an in-flight Promise, so:
 *   - Redundant list calls (`getArtists`, `getNews`, etc. called from both a
 *     list page and `getStaticPaths`) collapse to one network round-trip.
 *   - The bulk-news pattern in `getNewsForArtist` (fetch all once, filter
 *     locally) costs exactly one FM call regardless of how many artist pages
 *     ask for news.
 *   - Repeat Shopify lookups for the same `collectionId` collapse to one.
 *
 * Token requests are deliberately NOT cached — auth flow stays live.
 *
 * Note: A disk cache that survives dev-server restarts was attempted but the
 * Cloudflare adapter's workerd-flavored SSR rejects Node builtins even when
 * `output: "static"`. In-memory dedup alone removes the bulk of the work,
 * and prod builds run once per deploy so disk persistence buys little there.
 */

const memCache = new Map<string, Promise<unknown>>();

function key(namespace: string, payload: unknown): string {
  return `${namespace}:${JSON.stringify(payload)}`;
}

/**
 * Cache a build-time fetch by (namespace, payload). Same-process repeats
 * share the in-flight Promise.
 */
export function cached<T>(
  namespace: string,
  payload: unknown,
  loader: () => Promise<T>,
): Promise<T> {
  const k = key(namespace, payload);
  const inFlight = memCache.get(k) as Promise<T> | undefined;
  if (inFlight) return inFlight;

  const p = loader();
  memCache.set(k, p);
  // Drop failed promises so a retry can start fresh.
  p.catch(() => memCache.delete(k));
  return p;
}

/**
 * KV read-through for FileMaker finds. Lives in its own module (not in
 * filemaker.ts) so it can be unit-tested under plain Node: filemaker.ts pulls
 * in fm-image-mirror.ts, which reads `import.meta.env` at module load and
 * cannot be imported outside Vite.
 */
import { kvCached, type KvLike } from "./cache.ts";
import type { FmFindBody } from "./filemaker.ts";
import { sha256Hex } from "./http.ts";
import { timeServer } from "./server-timing.ts";

// ---------------------------------------------------------------------------
// Cross-isolate KV read-through for FM finds (2026-09-12)
// ---------------------------------------------------------------------------
//
// WHY. The in-memory `cached()` layer above is per ISOLATE and lives 60 s.
// Worker isolates are recycled constantly, so the first render on each one
// pays FM in full — and FM is the slowest thing on the cold path: measured
// on staging via Server-Timing, the previous-artists find set cost
// `fmnet 3002 ms` of a 3.9 s TTFB. This layer lets any isolate reuse a find
// another isolate (or the every-minute publication tick, which runs the same
// getters) performed in the last two minutes, so a cold isolate reads ~1 MB
// from KV in ~100 ms instead of waiting seconds on FM.
//
// PUBLISH SEMANTICS PRESERVED. The key embeds the same `cache-version` epoch
// the edge cache uses, so a Publish (which bumps it) makes every FM read
// miss this layer once and re-fetch live. Between Publishes, the visitor-
// visible freshness is already governed by the page tiers (5 min–24 h), which
// this 120 s layer sits comfortably inside. The publication tick observes FM
// at most ~2 min late, still within its one-minute-cadence goal's spirit.
//
// NOT a correctness layer: no KV binding (static build, Node dev) means a
// straight call; a KV failure means a straight call.
const FM_KV_TTL_SECONDS = 120;
const FM_KV_VERSION_MEMO_MS = 60_000;

let versionMemo: { value: string; expires: number } | null = null;

async function fmCacheVersion(kv: KvLike): Promise<string> {
  const now = Date.now();
  if (versionMemo && now < versionMemo.expires) return versionMemo.value;
  let value = "0";
  try {
    value = (await kv.get("cache-version", { cacheTtl: 60 })) ?? "0";
  } catch {
    // KV unavailable → still cache under epoch "0"; the edge cache has the
    // same fallback (src/middleware.ts).
  }
  versionMemo = { value, expires: now + FM_KV_VERSION_MEMO_MS };
  return value;
}

/** Content-addressed find key: epoch + layout + shape + exact query body. */
export async function fmKvKey(version: string, layout: string, body: FmFindBody, withPortals: boolean): Promise<string> {
  return `fm:v1:${version}:${withPortals ? "p" : "f"}:${layout}:${await sha256Hex(JSON.stringify(body))}`;
}

/** The read-through itself; `kv` is injected so tests can drive it. */
export async function fmFindViaKv<T>(
  kv: KvLike | null | undefined,
  layout: string,
  body: FmFindBody,
  withPortals: boolean,
  loader: () => Promise<T[]>,
): Promise<T[]> {
  if (!kv) return loader();
  const version = await fmCacheVersion(kv);
  const key = await fmKvKey(version, layout, body, withPortals);
  return timeServer("fmkv", () => kvCached<T[]>(kv, key, FM_KV_TTL_SECONDS, loader));
}


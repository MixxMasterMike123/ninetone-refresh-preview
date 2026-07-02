/**
 * Guarded access to the Cloudflare Workers runtime module.
 *
 * `cloudflare:workers` exposes `env` (bindings: KV, vars, secrets) natively
 * inside workerd — including `astro dev` under the adapter's Vite plugin —
 * and simply doesn't exist under Node (static GH build / plain dev). The
 * dynamic import is @vite-ignore'd so neither bundler mode tries to resolve
 * it; at runtime it either loads or rejects, and we memoize the outcome.
 */

export type CacheStateKv = {
  get(key: string, opts?: { cacheTtl?: number }): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
};

export type CfEnv = Record<string, unknown> & {
  CACHE_STATE?: CacheStateKv;
  PUBLISH_PASSWORD?: string;
};

let cfEnvPromise: Promise<CfEnv | null> | null = null;

export function getCfEnv(): Promise<CfEnv | null> {
  if (!cfEnvPromise) {
    cfEnvPromise = import(/* @vite-ignore */ "cloudflare:workers").then(
      (m: { env?: CfEnv }) => m.env ?? null,
      () => null,
    );
  }
  return cfEnvPromise;
}

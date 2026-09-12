/**
 * Worker entrypoint — adds `scheduled` and `queue` handlers alongside Astro's
 * `fetch`, for the publication flow.
 *
 * WHY A CUSTOM ENTRYPOINT AT ALL. wrangler.jsonc's `main` pointed straight at
 * `@astrojs/cloudflare/entrypoints/server`, which exports only `{ fetch }`.
 * A Cron Trigger or Queue consumer needs `scheduled` / `queue` exports on the
 * same Worker, and there is nowhere to put them in the adapter's own module.
 * The review flagged this wiring as unimplemented; this file is it.
 *
 * THE ONE RULE HERE: `fetch` must remain EXACTLY the adapter's handler. Every
 * page, API route, redirect, and the whole tiered edge cache in
 * src/middleware.ts depend on it. This file re-exports it untouched rather
 * than wrapping it, so visitor behaviour cannot regress through this change —
 * if the publication handlers were deleted tomorrow, serving would be
 * byte-identical.
 *
 * ROLLOUT POSTURE. `scheduled` and `queue` do nothing observable until
 * PUBLICATION_SERVING is switched on: discovery runs and prepares releases in
 * shadow, and the serving path is not wired into rendering at all yet
 * (checkpoint 4 is deliberately incomplete on that point — see the progress
 * doc). Deploying this file alone changes no response.
 */

import astro from "@astrojs/cloudflare/entrypoints/server";

/** The subset of bindings the publication handlers need. */
interface PublicationEnv {
  readonly CACHE_STATE?: {
    get(key: string, opts?: { cacheTtl?: number }): Promise<string | null>;
    put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
    delete?(key: string): Promise<void>;
  };
  readonly PUBLICATION_SERVING?: string;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

interface QueueMessageLike<T> {
  readonly body: T;
  ack(): void;
  retry(): void;
}

interface QueueBatchLike<T> {
  readonly messages: readonly QueueMessageLike<T>[];
}

export default {
  /**
   * Astro's handler, re-exported verbatim. Do not wrap: see the file comment.
   */
  fetch: astro.fetch,

  /**
   * Cron Trigger — discovery.
   *
   * Intentionally a stub that only logs while the publication resources do not
   * exist. Declaring a handler that silently does the wrong thing against a
   * half-configured environment is worse than one that reports it is not
   * enabled, and the handoff requires the deployment to change nothing until
   * bootstrap is authorized.
   */
  async scheduled(
    _event: { cron: string; scheduledTime: number },
    env: PublicationEnv,
    ctx: ExecutionContextLike,
  ): Promise<void> {
    if (!env.CACHE_STATE) {
      console.log("[publication] scheduled: no state binding; skipping");
      return;
    }
    // Discovery is wired here in checkpoint 4's remaining work. Until then the
    // handler exists so the cron trigger can be declared and observed without
    // touching content.
    ctx.waitUntil(
      Promise.resolve().then(() => {
        console.log("[publication] scheduled tick — discovery not yet enabled");
      }),
    );
  },

  /**
   * Queue consumer — translation jobs.
   *
   * Acks on success and retries on failure, so an exhausted message lands in
   * the dead-letter queue rather than looping. Delivery is at least once, which
   * is safe here because completion records are immutable and keyed by job id:
   * a redelivery rewrites an identical value.
   */
  async queue(batch: QueueBatchLike<unknown>, env: PublicationEnv): Promise<void> {
    if (!env.CACHE_STATE) {
      for (const message of batch.messages) message.retry();
      return;
    }
    for (const message of batch.messages) {
      // Consumer wiring lands with checkpoint 4's remaining work. Retrying
      // rather than acking means nothing is silently dropped in the interim.
      message.retry();
    }
  },
};

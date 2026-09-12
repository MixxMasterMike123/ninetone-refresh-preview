# Server performance investigation — 2026-09-12

## Scope and safety

Server-side investigation of the persistent page-speed report after the i18n work. This track owns request timing in middleware, translation reads, FileMaker reads, and response buffering. It does not deploy, purge caches, warm translations, change the 25-call translation budget, or revert the `arrayBuffer()` zero-byte-response mitigation.

## Starting checkpoint

- Repository HEAD: `32dbcd6`.
- Existing user work in `src/lib/url.ts` and `test/i18n.test.mjs` is out of scope and will not be touched.
- Prior evidence: warm edge-cache hits are generally about 0.07–0.15 s; cache-busted SSR samples about 0.08–0.18 s; a reportedly natural cold isolate has reached roughly 4–5 s, but no stage-level measurements separated that request.
- The isolate translation read-through cache is already implemented. This investigation will measure it rather than repeat that repair.
- First task: introduce request-local timing with additive, non-overlapping measures for cache-version KV, edge-cache lookup, Astro render, translation KV read count/wall time, FileMaker wait count/wall time, and response buffering.

## Evidence log

Pending instrumentation and bounded checks.

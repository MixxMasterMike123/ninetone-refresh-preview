# Persistent page-speed investigation — 2026-09-12

## Checkpoint 0: baseline

- In progress; source baseline `32dbcd6`.
- Continue from `perf-handoff-2026-09-12.md`. Translation isolate cache is already implemented; prior serial-KV diagnosis needs fresh measurement.
- Preserve existing uncommitted `src/lib/url.ts` and `test/i18n.test.mjs` changes.
- No deployment, translation warming, cache purge, or form submissions.
- Keep full-body buffering until an alternative preserves the documented zero-byte-response fix; keep translation budget unchanged.

## Section 1: server response path

Pending. Checkpoint: `performance-server-2026-09-12.md`.

## Section 2: browser rendering and payload

Pending. Checkpoint: `performance-browser-2026-09-12.md`.

## Verification and next steps

Pending. Separate actual cold-isolate observations from cache-bypass requests, and compressed transfer bytes from decoded HTML size. No cold-state claims based on query strings alone.

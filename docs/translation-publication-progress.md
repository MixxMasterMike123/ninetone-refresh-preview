# Translation-publication implementation — progress

Live progress log for
[the implementation handoff](translation-publication-implementation-handoff.md)
and [the design](translation-publication-plan-2026-09-12.md). Updated after
every section. **Not yet deployed; no new Cloudflare infrastructure exists.**

## Resume commands

```sh
nvm use 22
npm test                                  # full suite
node --experimental-strip-types --test test/publication.test.mjs   # this work only
npm run build        # gh target
npm run build:cf     # cf target — ALWAYS rerun immediately before any deploy
```

Both builds write to the same `dist/`. Never run them concurrently, and always
rebuild CF immediately before a Worker deploy — running the gh build afterwards
silently leaves stale server output and `wrangler deploy` ships the wrong bundle.

## Cloudflare resource naming

The user asked that anything new be findable in the Cloudflare dashboard. The
existing `CACHE_STATE` namespace was unidentifiable among seven and had to be
renamed mid-session; that is the mistake this convention exists to avoid.

| Kind | Name | Purpose |
|---|---|---|
| Worker | `ninetone-site` | existing site Worker (cron handler added here, not a second Worker) |
| KV | `ninetone-translations-cache` | existing translation cache (`CACHE_STATE` binding) |
| KV | `ninetone-publication-state` | discovery/job state and release pointers |
| KV | `ninetone-publication-releases` | immutable release bundles |
| Queue | `ninetone-translation-jobs` | field-level translation work |
| Queue | `ninetone-translation-jobs-dlq` | dead letter |
| Durable Object | `NinetonePublicationCoordinator` | serializes candidate state and promotion |

Bindings stay SCREAMING_SNAKE per Worker convention; the *resource* names above
are what appear in the dashboard.

## Status

| Checkpoint | State |
|---|---|
| 0. Baseline committed and pushed | **Done** — `85546d4`, pushed to `origin/i18n-phase-2` |
| 1. Inventory and contracts | **Done, review-corrected** — 6 counterexamples fixed |
| 2. Background preparation | **Done, review-corrected** — immutable completions |
| 3. Safe publication | **Done** (logic) — `release.ts`, 15 tests |
| 4. Serving and lifecycle | Not started |
| 5. Validation and rollout | Not started |

## Log

### Checkpoint 0 — baseline (done)

Committed the concurrent work found in the tree as `85546d4` and pushed the
branch. That commit is explicitly **not** authored by this work — it holds
another agent's Server-Timing instrumentation, hover-art, RosterIndex
duplicate-translation fixes, WebP banners, and performance evidence. Verified
green before committing rather than reviewed line by line: 366 tests, both
builds, clean post-build audit over 548 pages.

Starting HEAD for the implementation: `85546d4`.

### Checkpoint 1 — inventory and contracts (done)

`src/lib/publication/contracts.ts` (new) + `test/publication.test.mjs` (21
tests). Deliberately pure: no Cloudflare bindings, no FM imports, no Astro
globals, so the rules deciding "is this safe to publish" are testable without
a build or a network.

**Inventory taken from the rendering code, not the warm script.** The two had
already drifted once — the warm script wrote WebPosts titles on the `quality`
tier while `fmText()` reads `fast`, so those keys were never looked up and
/team rendered English under Swedish chrome while a correct translation sat
unused in KV. `ENTITY_FIELDS` is derived from the actual `fm()` call sites,
and a test now pins `ENTITY_TIER === "fast"` against `CHROME_TIER === "quality"`.

Nine entity kinds: artist, previousArtist, client, bookingTalent,
bookingCategory, teamMember, newsPost, webPostSection, guide.

Contracts defined: `SourceRecord` (+ content hash), `TranslationJob` (+ stable
`jobId` for at-least-once dedup), `Candidate` (completeness and supersession),
`Release` (+ `validateRelease`).

Decisions worth recording:

- **Hash, not timestamp.** FM has no reliable modified-at on these layouts
  (sitemap-pages.xml.ts omits lastmod for the same reason). Hashing
  publication-relevant fields makes an unchanged re-save produce no work, and
  makes supersession decidable.
- **`normalizeFields` trims** at the one place the hash is computed, matching
  the warm script's `job()`. A stray trailing newline previously produced a
  different sha256 from the warmed key — a permanent miss affecting 67 of 886
  fields.
- **Both locales are always required**, including a record's own source
  language. Team copy is authored in English while most of the site is
  Swedish; a one-directional assumption leaves one locale permanently
  untranslated.
- **Only fields the source actually has are required**, so an artist with no
  short blurb is not blocked for lacking its translation.
- **`validateRelease` is explicitly mechanical.** It catches missing locales,
  missing fields, empty values, dangling references and duplicate ids. It does
  not and cannot promise linguistic quality — that is what
  `src/i18n/overrides.json` and human review are for.

Tests: 387 total (21 new), all passing.

### Checkpoint 2 — background preparation, logic (done)

`src/lib/publication/discovery.ts` + 16 tests. Everything external is injected
(`loadRecords`, `store`, `hash`), so scan/dedupe/supersede/removal logic runs
locally with no network, no bindings, and no translation spend. The Worker
layer will be a thin adapter over this.

Covered by tests, each matching an acceptance requirement in the handoff:

- unchanged hash produces **no work at all**; an edit is rediscovered
- an inactive record is a removal and generates **zero** translation jobs, so
  a withdrawal is never held behind prose work
- job completion is **idempotent**, which is what makes at-least-once queue
  delivery safe
- a **late completion from an older edit is refused**, not merged, and its
  candidate is marked superseded
- a completion for an unknown candidate is refused rather than creating one
- `selectPublishable` withholds a record whose reference is not ready (the
  artist + two posts scenario), includes the group once all are ready, does
  **not** let one failed record block unrelated ready records, and iterates to
  a fixed point when dropping a record strands another

**Honest limitation recorded in the code:** the scan lock is advisory, not a
mutex — KV has no atomic compare-and-set, so two scanners starting in the same
instant can both proceed. That is tolerable only because discovery is
idempotent (same hashes produce the same candidates and job ids), so a double
scan wastes work rather than corrupting state. Promotion is the operation that
genuinely cannot tolerate a race, which is why the design puts it behind a
Durable Object.

**Also recorded honestly:** discovery cannot detect that several separate FM
saves form one finished editorial transaction. Nothing in the Data API marks a
set of saves as complete. Grouping works only through explicit references on a
record; saves made after a candidate publishes are a subsequent update.

Tests: 403 total (16 new), all passing.

### Checkpoint 3 — safe publication (in progress)

Next: immutable release bundles, serialized promotion with a known-good
fallback, and the KV-eventual-consistency handling (a pointer alone is not
readiness).

### Review corrections (docs/publication-checkpoints-1-2-review.md)

The review found six counterexamples in checkpoints 1–2. **Every one was
reproduced locally before being fixed**, and each is now a regression test in
`test/publication-review-regressions.test.mjs` (15 cases). Re-running the
review's own reproductions afterwards: **6/6 fixed**.

| Finding | Fix |
|---|---|
| P1 crash between `newestHash` and candidate strands the version forever | `discover()` treats a known hash with a MISSING candidate as outstanding work, so the window is closed from either write order. `reconcile()` recovers the second window (candidate persisted, never enqueued) by deriving outstanding jobs from what is missing. |
| P1 concurrent completions lose progress; duplicate scan resets it | Completions are now **immutable per-job records** at their own keys. Writing one never touches another, so concurrency cannot collide and a rescan has no progress field to reset. Candidate state is DERIVED by `reconcile()`. |
| P1 validation cannot prove completeness | `ReleaseEntity` carries an explicit `requiredFields` manifest and `routes`. Requirements no longer come from whichever keys happen to be in the output. |
| P1 disappeared records are not removals | Membership is compared against an authoritative inventory from the last **complete** scan, gated on `inventoryComplete` so a partial FM read can never be read as mass deletion. |
| P2 reverse references publish an artist alone | `selectPublishable()` now binds references in **both** directions and uses kind-qualified identities throughout. |
| P2 invalid KV TTL | `expirationTtl: 1` is rejected by Cloudflare (minimum 60 — verified against the official docs). The lock now deletes; the test fake throws on any TTL below 60, so this cannot pass again against a lenient stub. |

**Two claims withdrawn rather than defended.** The comment saying the crash
window "self-repairs" described the failure — the review was right. And
`validateRelease` no longer claims to check protected names: names are
protected at translation time via `protect`, and verifying afterwards needs
the source text a release entity does not carry. If that check is wanted it
belongs in the queue consumer.

**Also confirmed from the Cloudflare docs while fixing this:** KV allows
**one write per second per key**. That is independent of the lost-update race
and on its own disqualifies a mutable shared candidate blob — a hot candidate
would have produced 429s. It is recorded in the module comment so the pattern
is not reintroduced elsewhere.

**Still outstanding from the review, and not claimed as done:** the coordinator
must serialize candidate/job state, not only release promotion. The immutable
completion records remove the lost-update race that made the current design
unsafe, but the advisory KV scan lock remains advisory. When the Durable Object
lands in checkpoint 3 it should own discovery serialization and the advisory
lock should be deleted. That is written at the lock itself.

Tests: 419 total (15 new regressions; 38 checkpoint tests updated to the
corrected contracts), all passing.

### Checkpoint 3 — safe publication, logic (done)

`src/lib/publication/release.ts` + `test/publication-release.test.mjs` (15
tests). Assembly, promotion gates, generation resolution, rollback, and the
urgent-removal path.

**A pointer is never treated as readiness.** Three rules, each tested:

1. `storeRelease()` writes the bundle, THEN a readiness marker. A crash between
   them leaves a bundle with no marker, which reads as not-ready — safe, and
   repaired by the next attempt. The reverse order would publish a marker for a
   bundle that may not be readable.
2. `verifyGenerationReadable()` checks BOTH the marker and that the bundle
   parses back. KV is eventually consistent, so a marker visible at one edge
   does not prove the bundle is.
3. `resolveGeneration()` walks retained history when the pointer names
   something unreadable, and returns **null** rather than anything partial when
   nothing is readable — the caller then keeps its existing behaviour and never
   falls through to live untranslated FM.

`promoteRelease()` gates on validation, then staleness (`rejectStalePromotion`
re-reads newest hashes immediately before committing), then readability. The
pointer write is last.

Mixed generations across edges are safe by construction: every generation
validates as a whole, so an edge serving an older one shows a consistent older
site rather than a new listing linking to a missing detail page. Tested
explicitly.

`withRemovals()` derives a removal generation by FILTERING an existing one —
no translation involved — and drops references to removed entities from the
survivors so nothing can link to something gone. A late completion cannot
re-promote a superseded bundle and resurrect a withdrawn record; also tested.

**Stated limitation, not hidden:** the current pointer is the one mutable key
in the release path. Without the Durable Object, two concurrent promotions can
still overwrite each other's pointer. Both would name a complete, internally
consistent generation, so the failure mode is "an older complete site wins"
rather than corruption — but it is real, and it is written at `promoteRelease`.
The coordinator in checkpoint 4 is what closes it.

Tests: 434 total (15 new), all passing.

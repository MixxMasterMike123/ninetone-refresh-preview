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
| 1. Inventory and contracts | **Done** — `src/lib/publication/contracts.ts`, 21 tests |
| 2. Background preparation | In progress |
| 3. Safe publication | Not started |
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

### Checkpoint 2 — background preparation (in progress)

Next: discovery that reads the existing FM helpers, computes source hashes,
and persists candidate/job state — still with no Cloudflare resources
declared, so it can be tested locally before any infrastructure exists.

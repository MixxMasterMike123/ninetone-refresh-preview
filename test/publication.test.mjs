import assert from "node:assert/strict";
import test from "node:test";

import {
  SUPPORTED_LOCALES,
  ENTITY_FIELDS,
  ENTITY_TIER,
  CHROME_TIER,
  normalizeFields,
  sourceHashInput,
  jobId,
  jobsForRecord,
  isCandidateComplete,
  isSuperseded,
  validateRelease,
  isReleasePromotable,
} from "../src/lib/publication/contracts.ts";

// ---------------------------------------------------------------------------
// Field inventory — the contract that has already drifted once
// ---------------------------------------------------------------------------

test("entity prose is warmed on the SAME tier fmText() reads", () => {
  // The tier is part of the translation cache key. The warm script once wrote
  // WebPosts titles on "quality" while src/lib/t.ts's fmText() asked for
  // "fast", so those keys were never looked up and /team rendered English
  // under Swedish chrome while a correct translation sat unused in KV. This
  // asserts the two halves of that contract stay in agreement.
  assert.equal(ENTITY_TIER, "fast", "fmText() requests the fast tier");
  assert.equal(CHROME_TIER, "quality", "sharedT() requests the quality tier");
  assert.notEqual(ENTITY_TIER, CHROME_TIER);
});

test("every entity kind declares at least one translatable field", () => {
  for (const [kind, fields] of Object.entries(ENTITY_FIELDS)) {
    assert.ok(fields.length > 0, `${kind} must declare fields`);
    for (const f of fields) {
      assert.ok(["plain", "markdown", "title"].includes(f.kind), `${kind}.${f.field} kind`);
    }
  }
});

test("bios are markdown so renderBio still receives markdown (decision 8)", () => {
  const bio = ENTITY_FIELDS.artist.find((f) => f.field === "artistPresentationString");
  assert.equal(bio?.kind, "markdown");
  const body = ENTITY_FIELDS.newsPost.find((f) => f.field === "MessageString");
  assert.equal(body?.kind, "markdown");
});

// ---------------------------------------------------------------------------
// Normalization and hashing
// ---------------------------------------------------------------------------

test("normalizeFields trims, matching the warm script's job()", () => {
  // A stray trailing newline in an FM field produced a different sha256 from
  // the warmed key and therefore a permanent cache miss — 67 of 886 fields
  // were affected before this was fixed. Normalizing where the hash is
  // computed keeps that from recurring.
  const fields = normalizeFields("artist", {
    "Artist Presentation Title": "  A tagline\n",
    artistPresentationString: "Bio text",
  });
  assert.equal(fields["Artist Presentation Title"], "A tagline");
  assert.equal(fields.artistPresentationString, "Bio text");
});

test("normalizeFields omits empty and whitespace-only fields", () => {
  const fields = normalizeFields("artist", {
    "Artist Presentation Title": "   ",
    artistPresentationString: "",
    artistPresentationShort: null,
  });
  assert.deepEqual(fields, {});
});

test("sourceHashInput is stable across key order but changes with content", () => {
  const base = {
    kind: "artist",
    id: "anjo",
    fields: { a: "1", b: "2" },
    references: ["news:x", "news:y"],
    active: true,
  };
  const reordered = {
    ...base,
    fields: { b: "2", a: "1" },
    references: ["news:y", "news:x"],
  };
  assert.equal(sourceHashInput(base, "v1"), sourceHashInput(reordered, "v1"));
  assert.notEqual(sourceHashInput(base, "v1"), sourceHashInput({ ...base, fields: { a: "1", b: "3" } }, "v1"));
});

test("sourceHashInput changes when the prompt version changes", () => {
  // A prompt change invalidates every existing translation, so it must produce
  // new hashes rather than silently reusing work done under the old prompt.
  const record = { kind: "artist", id: "anjo", fields: { a: "1" }, references: [], active: true };
  assert.notEqual(sourceHashInput(record, "v1"), sourceHashInput(record, "v2"));
});

test("sourceHashInput distinguishes an activation change with identical prose", () => {
  const record = { kind: "artist", id: "anjo", fields: { a: "1" }, references: [], active: true };
  assert.notEqual(sourceHashInput(record, "v1"), sourceHashInput({ ...record, active: false }, "v1"));
});

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

test("jobsForRecord emits one job per non-empty field per locale, both directions", () => {
  // Both locales including the record's own source language: the Team section
  // is authored in English while most of the site is Swedish, so a
  // one-directional assumption leaves one of them permanently untranslated.
  const record = {
    kind: "artist",
    id: "anjo",
    hash: "h1",
    fields: { "Artist Presentation Title": "T", artistPresentationString: "B" },
    references: [],
    active: true,
  };
  const jobs = jobsForRecord(record);
  assert.equal(jobs.length, 2 * SUPPORTED_LOCALES.length);
  assert.deepEqual([...new Set(jobs.map((j) => j.target))].sort(), ["en", "sv"]);
  assert.ok(jobs.every((j) => j.tier === "fast"));
});

test("jobsForRecord emits nothing for an inactive record", () => {
  // Withdrawals take the priority removal path and must never be held behind
  // translation work.
  const jobs = jobsForRecord({
    kind: "artist",
    id: "gone",
    hash: "h1",
    fields: { artistPresentationString: "B" },
    references: [],
    active: false,
  });
  assert.deepEqual(jobs, []);
});

test("jobId is stable for identical work and distinct across every dimension", () => {
  const base = {
    entityKind: "artist",
    entityId: "anjo",
    sourceHash: "h1",
    field: "bio",
    target: "en",
    kind: "markdown",
    tier: "fast",
    protect: [],
  };
  assert.equal(jobId(base, "v1"), jobId({ ...base }, "v1"));
  for (const [k, v] of Object.entries({
    entityId: "other",
    sourceHash: "h2",
    field: "other",
    target: "sv",
    kind: "plain",
    tier: "quality",
  })) {
    assert.notEqual(jobId(base, "v1"), jobId({ ...base, [k]: v }, "v1"), `${k} must affect the id`);
  }
  assert.notEqual(jobId(base, "v1"), jobId(base, "v2"), "key version must affect the id");
});

// ---------------------------------------------------------------------------
// Candidates — supersession and completeness
// ---------------------------------------------------------------------------

test("a candidate is complete only when every required job is done", () => {
  const candidate = {
    entityKind: "artist",
    entityId: "anjo",
    sourceHash: "h1",
    state: "preparing",
    requiredJobIds: ["a", "b"],
    completed: { a: true },
  };
  assert.equal(isCandidateComplete(candidate), false);
  assert.equal(isCandidateComplete({ ...candidate, completed: { a: true, b: true } }), true);
});

test("a candidate is superseded when FM changed during translation", () => {
  // The acceptance requirement: an older queue message completing late must
  // never overwrite state for a newer edit.
  const candidate = {
    entityKind: "artist",
    entityId: "anjo",
    sourceHash: "h1",
    state: "preparing",
    requiredJobIds: [],
    completed: {},
  };
  assert.equal(isSuperseded(candidate, "h2"), true);
  assert.equal(isSuperseded(candidate, "h1"), false);
  assert.equal(isSuperseded(candidate, undefined), false, "no newer hash known: not superseded");
});

// ---------------------------------------------------------------------------
// Release validation
// ---------------------------------------------------------------------------

function releaseWith(entities) {
  return {
    generation: "g1",
    createdAt: "2026-09-12T00:00:00Z",
    entities,
    routes: [],
    buildId: "b1",
    promptVersion: "v1",
  };
}

const completeArtist = {
  kind: "artist",
  id: "anjo",
  sourceHash: "h1",
  references: [],
  text: {
    sv: { "Artist Presentation Title": "Svensk titel", artistPresentationString: "Svensk bio" },
    en: { "Artist Presentation Title": "English title", artistPresentationString: "English bio" },
  },
};

test("a complete release validates and is promotable", () => {
  assert.deepEqual(validateRelease(releaseWith([completeArtist])), []);
  assert.equal(isReleasePromotable(releaseWith([completeArtist])), true);
});

test("a missing locale blocks promotion", () => {
  const broken = { ...completeArtist, text: { sv: completeArtist.text.sv } };
  const issues = validateRelease(releaseWith([broken]));
  assert.ok(issues.some((i) => i.type === "missing-locale" && i.locale === "en"));
  assert.equal(isReleasePromotable(releaseWith([broken])), false);
});

test("a field present in one locale but missing in the other blocks promotion", () => {
  // This is the exact shape of the bug that shipped: an English page rendering
  // Swedish source because one field never got its translation.
  const broken = {
    ...completeArtist,
    text: {
      sv: completeArtist.text.sv,
      en: { "Artist Presentation Title": "English title" },
    },
  };
  const issues = validateRelease(releaseWith([broken]));
  assert.ok(
    issues.some((i) => i.type === "missing-field" && i.locale === "en" && i.field === "artistPresentationString"),
  );
});

test("an empty translated value blocks promotion", () => {
  const broken = {
    ...completeArtist,
    text: {
      sv: completeArtist.text.sv,
      en: { ...completeArtist.text.en, artistPresentationString: "   " },
    },
  };
  assert.ok(validateRelease(releaseWith([broken])).some((i) => i.type === "empty-value"));
});

test("a field absent from BOTH locales is not required", () => {
  // An artist with no short blurb must not be blocked for lacking its
  // translation — only fields the source actually had are required.
  assert.deepEqual(validateRelease(releaseWith([completeArtist])), []);
});

test("a link to an entity outside the release blocks promotion", () => {
  // The acceptance scenario: a new artist plus two related posts must publish
  // together, so a listing link can never point at an unavailable detail page.
  const artist = { ...completeArtist, references: ["news:unreleased"] };
  const issues = validateRelease(releaseWith([artist]));
  assert.ok(issues.some((i) => i.type === "dangling-reference" && i.reference === "news:unreleased"));
});

test("a reference satisfied inside the same release validates", () => {
  const post = {
    kind: "newsPost",
    id: "news:launch",
    sourceHash: "h2",
    references: [],
    text: {
      sv: { Title: "Svensk rubrik", shortMessage: "Svensk ingress", MessageString: "Svensk text" },
      en: { Title: "English headline", shortMessage: "English standfirst", MessageString: "English body" },
    },
  };
  const artist = { ...completeArtist, references: ["news:launch"] };
  assert.deepEqual(validateRelease(releaseWith([artist, post])), []);
});

test("duplicate entity ids are rejected", () => {
  assert.ok(
    validateRelease(releaseWith([completeArtist, completeArtist])).some((i) => i.type === "duplicate-id"),
  );
});

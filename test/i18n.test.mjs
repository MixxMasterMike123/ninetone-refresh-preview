import assert from "node:assert/strict";
import test from "node:test";

import {
  localizedPath,
  alternatePath,
  otherLang,
  stripLocale,
  hreflangLinks,
  switchHref,
} from "../src/lib/i18n.ts";

// ---------------------------------------------------------------------------
// otherLang
// ---------------------------------------------------------------------------

test("otherLang flips between the two supported locales", () => {
  assert.equal(otherLang("sv"), "en");
  assert.equal(otherLang("en"), "sv");
});

// ---------------------------------------------------------------------------
// stripLocale — the detection primitive src/middleware.ts's rewrite is
// built on. Its edge cases matter most: a bare "/en" segment boundary, not
// a string prefix, must be what triggers English detection.
// ---------------------------------------------------------------------------

test("stripLocale detects the root path as Swedish", () => {
  assert.deepEqual(stripLocale("/"), { path: "/", lang: "sv" });
});

test("stripLocale treats bare /en and /en/ both as English root, no trailing slash", () => {
  assert.deepEqual(stripLocale("/en"), { path: "/", lang: "en" });
  assert.deepEqual(stripLocale("/en/"), { path: "/", lang: "en" });
});

test("stripLocale strips a leading /en segment from a deeper path", () => {
  assert.deepEqual(stripLocale("/en/records"), { path: "/records", lang: "en" });
  assert.deepEqual(stripLocale("/en/records/artists/anjo"), {
    path: "/records/artists/anjo",
    lang: "en",
  });
});

test("stripLocale leaves an unprefixed path as Swedish", () => {
  assert.deepEqual(stripLocale("/records"), { path: "/records", lang: "sv" });
});

test("stripLocale does NOT treat a path merely starting with the letters 'en' as locale-prefixed", () => {
  // The failure mode this guards: a naive `path.startsWith("/en")` check
  // also matches "/enterprise" and "/english-something", silently
  // truncating them ("/enterprise" -> "/terprise") and mis-tagging them as
  // English. stripLocale requires a real segment boundary (the character
  // after "en" must be "/" or end-of-string).
  assert.deepEqual(stripLocale("/enterprise"), { path: "/enterprise", lang: "sv" });
  assert.deepEqual(stripLocale("/english-something"), {
    path: "/english-something",
    lang: "sv",
  });
  assert.deepEqual(stripLocale("/en-dash-thing"), { path: "/en-dash-thing", lang: "sv" });
});

// ---------------------------------------------------------------------------
// localizedPath
// ---------------------------------------------------------------------------

test("localizedPath: sv is the default locale, no prefix", () => {
  assert.equal(localizedPath("/records", "sv"), "/records");
  assert.equal(localizedPath("/", "sv"), "/");
});

test("localizedPath: en gets a /en prefix", () => {
  assert.equal(localizedPath("/records", "en"), "/en/records");
});

test("localizedPath: en root is /en, never /en/ (trailingSlash: never on the cf target)", () => {
  assert.equal(localizedPath("/", "en"), "/en");
});

// ---------------------------------------------------------------------------
// alternatePath — takes the CURRENT path (which may already carry /en) and
// returns the alternate in the given language. This is what the header
// language switch calls.
// ---------------------------------------------------------------------------

test("alternatePath: / <-> /en", () => {
  assert.equal(alternatePath("/", "en"), "/en");
  assert.equal(alternatePath("/en", "sv"), "/");
});

test("alternatePath: /en itself (not /en/) round-trips through the root", () => {
  assert.equal(alternatePath("/en", "en"), "/en");
});

test("alternatePath: /en/records -> /records and back", () => {
  assert.equal(alternatePath("/en/records", "sv"), "/records");
  assert.equal(alternatePath("/records", "en"), "/en/records");
});

test("alternatePath is idempotent when asking for the language already in effect", () => {
  assert.equal(alternatePath("/en/records", "en"), "/en/records");
  assert.equal(alternatePath("/records", "sv"), "/records");
});

test("alternatePath round-trips are stable: alternatePath(alternatePath(p, en), sv) === p", () => {
  for (const p of ["/", "/records", "/records/artists/anjo", "/ninetone-nation/booking", "/en"]) {
    const there = alternatePath(p, "en");
    const back = alternatePath(there, "sv");
    // "/en" as a literal starting path is itself already the English root,
    // so its round-trip destination is "/", not "/en" — stripLocale
    // correctly reduces "/en" to { path: "/", lang: "en" } first.
    const expected = stripLocaleExpected(p);
    assert.equal(back, expected, `round trip for ${p}`);
  }
});

function stripLocaleExpected(p) {
  return p === "/en" || p === "/en/" ? "/" : p;
}

// ---------------------------------------------------------------------------
// hreflangLinks — Base.astro's <link rel="alternate" hreflang> set.
// x-default = Swedish per decision 1 (sv is the root/default locale).
// ---------------------------------------------------------------------------

test("hreflangLinks emits absolute sv/en/x-default URLs, x-default pointing at Swedish", () => {
  const links = hreflangLinks("/records", "https://ninetone.com");
  assert.deepEqual(links, [
    { hreflang: "sv", href: "https://ninetone.com/records" },
    { hreflang: "en", href: "https://ninetone.com/en/records" },
    { hreflang: "x-default", href: "https://ninetone.com/records" },
  ]);
});

test("hreflangLinks works from an already-English current path", () => {
  const links = hreflangLinks("/en/records/artists/anjo", "https://ninetone.com");
  assert.deepEqual(links, [
    { hreflang: "sv", href: "https://ninetone.com/records/artists/anjo" },
    { hreflang: "en", href: "https://ninetone.com/en/records/artists/anjo" },
    { hreflang: "x-default", href: "https://ninetone.com/records/artists/anjo" },
  ]);
});

test("hreflangLinks on the root path never doubles the /en segment into /en/", () => {
  const links = hreflangLinks("/", "https://ninetone.com");
  assert.deepEqual(links, [
    { hreflang: "sv", href: "https://ninetone.com/" },
    { hreflang: "en", href: "https://ninetone.com/en" },
    { hreflang: "x-default", href: "https://ninetone.com/" },
  ]);
});

// ---------------------------------------------------------------------------
// switchHref — the header language-switch target (section 3). The whole
// point of this function's existence (rather than callers composing
// alternatePath(path, otherLang(lang)) inline) is the cf-target rewrite
// scenario: src/middleware.ts rewrites "/en/records" to a render of
// "/records" BEFORE Astro.url.pathname is ever read by a page/component, so
// by the time Header.astro runs, the pathname it sees is ALREADY
// locale-free — there is no "/en" left for stripLocale to find. The correct
// current language has to come from `locals.lang` (passed in here as
// `currentLang`), never re-derived from the post-rewrite path. These tests
// simulate exactly that: an English render where the path argument is
// already bare, the way it actually arrives on cf.
// ---------------------------------------------------------------------------

test("switchHref: sv request on a bare path -> the /en version", () => {
  assert.equal(switchHref("/records", "sv"), "/en/records");
  assert.equal(switchHref("/", "sv"), "/en");
});

test("switchHref: en request whose path is ALREADY rewritten bare (the cf post-rewrite shape) -> the sv version", () => {
  // This is the critical case: on cf, an English visitor on "/en/records" is
  // rendered from a NEXT("/records") rewrite, so Header.astro's
  // Astro.url.pathname is "/records", not "/en/records" — no /en prefix
  // survives for stripLocale to detect. switchHref must still produce the
  // Swedish URL ("/records" itself) using the explicitly-passed
  // currentLang="en", not whatever stripLocale would guess from the bare
  // path alone (which would incorrectly say "sv" and therefore treat "sv"
  // as the OTHER language, producing "/en/records" — the same page the
  // visitor is already on).
  assert.equal(switchHref("/records", "en"), "/records");
  assert.equal(switchHref("/", "en"), "/");
});

test("switchHref: also correct if a caller's path still carries a literal /en prefix (gh target shape, or a caller that didn't go through the rewrite)", () => {
  assert.equal(switchHref("/en/records", "en"), "/records");
  assert.equal(switchHref("/en/records", "sv"), "/en/records");
});

test("switchHref round-trips: switching twice, each time with the CORRECT currentLang for that render, returns to the original path", () => {
  // NOTE on why the second call passes `otherLang(lang)`: `switchHref` means
  // "the URL of the OTHER language from `currentLang`", so the two calls
  // model two SEPARATE page renders, not one render called twice. Starting
  // from "/records" as an "sv" render, the first call yields "/en/records".
  // A header rendered on THAT page is an "en" render — it knows its own
  // language from `locals.lang`, which is `otherLang("sv")` — so that is
  // what the second call receives, and it lands back on "/records".
  //
  // This mirrors the real constraint: a page render never receives "the
  // language I should treat this pathname as having come from", only its
  // own. That is exactly the ambiguity `switchHref`'s doc comment explains
  // a bare post-rewrite path cannot resolve on its own.
  for (const [path, lang] of [
    ["/", "sv"],
    ["/records", "sv"],
    ["/en/records", "en"],
    ["/ninetone-nation/booking", "sv"],
  ]) {
    const once = switchHref(path, lang);
    const twice = switchHref(once, otherLang(lang));
    assert.equal(twice, path, `round trip for ${path} (${lang})`);
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  localizedPath,
  alternatePath,
  otherLang,
  stripLocale,
  hreflangLinks,
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

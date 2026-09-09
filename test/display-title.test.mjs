import assert from "node:assert/strict";
import test from "node:test";

import { displayTitle } from "../src/lib/display-title.ts";

test("plain title is unchanged", () => {
  assert.equal(displayTitle("Artists"), "Artists");
});

test("strips a trailing pipe-separated Ninetone brand suffix", () => {
  assert.equal(
    displayTitle("Top Music Production & Artist Branding | Ninetone Records"),
    "Top Music Production & Artist Branding",
  );
});

test("strips an en-dash or em-dash Ninetone brand suffix", () => {
  assert.equal(displayTitle("Entertainers – Ninetone Nation"), "Entertainers");
  assert.equal(displayTitle("Entertainers — Ninetone Nation"), "Entertainers");
});

test("leaves a non-Ninetone suffix alone", () => {
  assert.equal(displayTitle("A | B"), "A | B");
});

test("trims surrounding whitespace", () => {
  assert.equal(displayTitle("  Artists  "), "Artists");
  assert.equal(displayTitle("  Artists | Ninetone Records  "), "Artists");
});

test("handles missing/empty input", () => {
  assert.equal(displayTitle(undefined), "");
  assert.equal(displayTitle(null), "");
  assert.equal(displayTitle(""), "");
  assert.equal(displayTitle("   "), "");
});

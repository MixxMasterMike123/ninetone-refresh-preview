import assert from "node:assert/strict";
import test from "node:test";

import { renderBio } from "../src/lib/markdown.ts";

test("renderBio: a markdown H1 in FM prose is demoted to H2, never emits <h1>", () => {
  const html = renderBio("# Emma Blyfors\n\nSome bio text.");
  assert.ok(!html.includes("<h1"), `expected no <h1>, got: ${html}`);
  assert.ok(html.includes("<h2>Emma Blyfors</h2>"));
});

test("renderBio: relative heading hierarchy is preserved when shifted down one level", () => {
  const html = renderBio("## Section\n\n### Subsection\n\n#### Detail");
  assert.ok(html.includes("<h3>Section</h3>"));
  assert.ok(html.includes("<h4>Subsection</h4>"));
  assert.ok(html.includes("<h5>Detail</h5>"));
});

test("renderBio: heading shift caps at h6 so it never overflows to an invalid tag", () => {
  const html = renderBio("###### Deepest heading");
  assert.ok(html.includes("<h6>Deepest heading</h6>"));
  assert.ok(!/<h7/.test(html));
});

test("renderBio: heading text still runs through inline markdown (links, bold)", () => {
  const html = renderBio("## **Bold** heading with [a link](https://example.com)");
  assert.ok(html.includes("<strong>Bold</strong>"));
  assert.ok(html.includes('<a href="https://example.com">a link</a>'));
});

#!/usr/bin/env node
/**
 * Post-build static audit for dist/.
 *
 * Pure Node, no TS, no FM round-trips. Catches the problems we can see in the
 * built output:
 *
 *   - FM streaming URLs leaked into HTML/JSON/JS/CSS (these expire and break
 *     within ~15 min — must be rewritten to the proxy)
 *   - Empty <img src=""> tags
 *   - Pages with empty <title>
 *   - Pages with empty <h1> (heuristic — a few legitimate template pages
 *     might trip this; surface for review, don't fail the build)
 *
 * Writes dist/_audit.json (machine-readable) and prints a human summary.
 * Always exits 0 — advisory only. CI can grep the JSON if it wants to gate
 * on specific issues.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DIST = path.resolve(process.argv[2] || "dist");
const FM_LEAK_RE = /https?:\/\/files\.ninetone\.com\/Streaming_SSL\/[^\s"'<>]+/g;
const EMPTY_IMG_RE = /<img[^>]*\bsrc=""[^>]*>/g;
const TITLE_RE = /<title>([^<]*)<\/title>/i;
const H1_RE = /<h1[^>]*>([\s\S]*?)<\/h1>/i;

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (e.isFile()) out.push(full);
  }
  return out;
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, "").trim();
}

async function main() {
  const files = await walk(DIST);
  const issues = [];
  let htmlCount = 0;

  for (const file of files) {
    const rel = path.relative(DIST, file);
    if (/\.(html|json|js|css)$/i.test(file)) {
      const content = await readFile(file, "utf8");
      const leaks = content.match(FM_LEAK_RE);
      if (leaks) {
        for (const url of [...new Set(leaks)]) {
          issues.push({ kind: "fm-url-leak", file: rel, detail: url });
        }
      }
    }
    if (/\.html$/i.test(file)) {
      htmlCount++;
      const content = await readFile(file, "utf8");

      const emptyImgs = content.match(EMPTY_IMG_RE);
      if (emptyImgs) {
        issues.push({ kind: "empty-img-src", file: rel, detail: `${emptyImgs.length}×` });
      }

      const title = content.match(TITLE_RE)?.[1]?.trim();
      if (!title) {
        issues.push({ kind: "empty-title", file: rel });
      }

      const h1 = content.match(H1_RE)?.[1];
      if (h1 != null && !stripTags(h1)) {
        issues.push({ kind: "empty-h1", file: rel });
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    distDir: DIST,
    htmlPages: htmlCount,
    issues,
  };

  await writeFile(path.join(DIST, "_audit.json"), JSON.stringify(report, null, 2));

  // Human summary
  const byKind = new Map();
  for (const i of issues) {
    const arr = byKind.get(i.kind) ?? [];
    arr.push(i);
    byKind.set(i.kind, arr);
  }
  const lines = [`Audit: scanned ${htmlCount} HTML pages`];
  if (byKind.size === 0) {
    lines.push("  ✓ No issues found");
  } else {
    for (const [kind, list] of [...byKind.entries()].sort()) {
      lines.push(`  ${kind}: ${list.length}`);
      for (const i of list.slice(0, 3)) {
        const detail = i.detail ? ` — ${i.detail}` : "";
        lines.push(`    · ${i.file}${detail}`);
      }
      if (list.length > 3) lines.push(`    … +${list.length - 3} more (see dist/_audit.json)`);
    }
  }
  process.stdout.write(lines.join("\n") + "\n");
}

main().catch((err) => {
  process.stderr.write(`Audit failed: ${err}\n`);
  // Never fail the build over an audit problem.
  process.exit(0);
});

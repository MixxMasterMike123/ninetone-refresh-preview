import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * Normalize reference-style link definitions written by ChatGPT-style editors.
 *
 * The bios in FileMaker contain reference markdown like:
 *   See ([Bjärenu][1]).
 *   ...
 *   [1]: https://bjarenu.se/... Stjärnspäckad sommarfest - bjarenu.se
 *
 * CommonMark requires the trailing title to be wrapped in quotes/parens.
 * Without that, marked falls back to printing the raw `[label][N]` text and
 * the `[N]: url ...` lines instead of resolving them. We rewrite each ref
 * line to `[N]: url "title"`, which marked handles natively.
 */
function normalizeReferenceDefs(text: string): string {
  return text.replace(
    /^(\[[^\]]+\]:\s*\S+)([ \t]+)(.+)$/gm,
    (_, prefix, _ws, rest) => `${prefix} "${String(rest).replace(/"/g, "'")}"`,
  );
}

/**
 * Strip tracking-only query params from URLs in markdown.
 *
 * Editors paste links from ChatGPT / various sources and they often carry
 * `?utm_source=chatgpt.com`, `fbclid=...`, etc. None of these affect where
 * the link goes, so we drop them at render time rather than asking content
 * editors to clean every URL by hand.
 */
const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "fbclid", "gclid", "gbraid", "wbraid", "msclkid", "yclid", "dclid",
  "mc_cid", "mc_eid", "_hsenc", "_hsmi", "hsCtaTracking",
  "ref", "ref_src", "ref_url", "igshid",
]);

function stripTrackingParams(url: string): string {
  try {
    const u = new URL(url);
    let dirty = false;
    [...u.searchParams.keys()].forEach((k) => {
      if (TRACKING_PARAMS.has(k.toLowerCase())) {
        u.searchParams.delete(k);
        dirty = true;
      }
    });
    if (!dirty) return url;
    // Drop the trailing "?" if no params remain
    let result = u.toString();
    if (u.search === "" && result.endsWith("?")) result = result.slice(0, -1);
    return result;
  } catch {
    return url; // not a parseable URL — leave it alone
  }
}

function cleanLinksInMarkdown(text: string): string {
  // Inline links: [label](https://...) and reference defs: [1]: https://...
  return text.replace(
    /(https?:\/\/[^\s)\]"']+)/g,
    (match) => stripTrackingParams(match),
  );
}

/**
 * Render FileMaker bio text as HTML.
 *
 * FileMaker stores line breaks as `\r` (carriage return), so we normalize
 * those to `\n` first. Editors write markdown (## headings, **bold**, links)
 * in the FM field, same as the DivHunt site does.
 *
 * Pipeline: \r→\n  →  normalize ref defs  →  strip utm_ and tracking params  →  marked
 */
export function renderBio(text: string | undefined | null): string {
  if (!text) return "";
  let processed = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  processed = normalizeReferenceDefs(processed);
  processed = cleanLinksInMarkdown(processed);
  return marked.parse(processed, { async: false }) as string;
}

/**
 * FM WebPosts/presentation titles are authored as SEO strings, e.g.
 * "Top Music Production & Artist Branding | Ninetone Records". Good for
 * <title>, wrong for an on-page tagline or heading. Strip a trailing
 * " | Ninetone …" / " – Ninetone …" / " — Ninetone …" brand-suffix segment
 * before rendering the raw FM string as display copy.
 *
 * Only strips when the suffix mentions "Ninetone" — an arbitrary "A | B"
 * title is left alone, since that separator is also legitimate prose.
 */
export function displayTitle(raw: string | undefined | null): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";

  const match = trimmed.match(/^([\s\S]*?)\s+[|–—]\s+([^|–—]+)$/);
  if (!match) return trimmed;

  const [, head, tail] = match;
  if (!/ninetone/i.test(tail)) return trimmed;

  return head.trim();
}

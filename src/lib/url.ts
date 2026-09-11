/**
 * Build a base-aware URL from a path that starts with "/".
 *
 * When the site is served from a sub-path (preview on GitHub Pages at
 * `/ninetone-refresh-preview/`), every internal link needs to include that
 * prefix. Astro exposes the configured base via `import.meta.env.BASE_URL`,
 * which is normalized to either `/` or `/some-path/` (always trailing slash).
 *
 * Use this on every absolute internal link, image src, fetch URL, and form
 * action. External URLs (starting with `http://`, `https://`, `mailto:`,
 * `tel:`, `#`) are returned unchanged.
 *
 * Example:
 *   url("/records/artists")  // "/ninetone-refresh-preview/records/artists"
 *   url("/")                 // "/ninetone-refresh-preview"
 *   url("https://x.com")     // "https://x.com"
 */
export function url(path: string, lang?: "sv" | "en"): string {
  if (!path) return path;
  if (/^([a-z]+:|#|\/\/)/i.test(path)) return path;
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  // LOCALE (i18n Phase 2). Without this every internal link on an English
  // page pointed at the bare Swedish path, so a single click anywhere — nav,
  // an artist card, a news card, pagination, a footer link, a CTA — silently
  // dropped the visitor back to Swedish. Applied HERE rather than at the ~53
  // call sites because every one of them already routes through this helper:
  // one change fixes them all and nothing new can be added that forgets.
  //
  // "sv" is the default locale at the root (decision 1), so it adds no
  // prefix and this stays a no-op for Swedish and for the entire gh/static
  // target, where `lang` is never passed.
  const withLocale = lang === "en" ? (path === "/" ? "/en" : `/en${path.startsWith("/") ? path : `/${path}`}`) : path;
  if (withLocale === "/") return base || "/";
  return `${base}${withLocale.startsWith("/") ? withLocale : `/${withLocale}`}`;
}

/**
 * `url()` pre-bound to one language, for components that build several links.
 *
 * Astro components reach the current locale via `Astro.locals.lang`
 * (src/middleware.ts sets it). Bind once in frontmatter —
 * `const u = urlFor(Astro.locals)` — and use `u("/records")` everywhere
 * instead of threading `lang` through every call.
 */
export function urlFor(locals: unknown): (path: string) => string {
  const lang = (locals as { lang?: "sv" | "en" } | null | undefined)?.lang;
  return (path: string) => url(path, lang);
}

/** Accept only web URLs supplied by CMS/API data for clickable external links. */
export function externalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(String(value).trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

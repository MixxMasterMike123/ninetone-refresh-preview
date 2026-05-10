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
export function url(path: string): string {
  if (!path) return path;
  if (/^([a-z]+:|#|\/\/)/i.test(path)) return path;
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  if (path === "/") return base || "/";
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

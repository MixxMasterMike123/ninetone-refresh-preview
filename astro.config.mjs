// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

// No Cloudflare adapter: output is fully static and nothing in the codebase
// uses Cloudflare runtime APIs (no locals.runtime, no KV at runtime, no
// Image service). The adapter wraps the prerender step in Miniflare, and
// Miniflare's fetch was failing against the FileMaker host — same call works
// fine from native Node. Plain static output deploys to Pages just as well.
// While the preview lives on GitHub Pages, the site is served under a path.
// Switch back to root + the production domain on launch:
//   site: "https://www.ninetone.com",
//   base: "/",
export default defineConfig({
  site: "https://mixxmastermike123.github.io",
  base: "/ninetone-refresh-preview",
  output: "static",
  trailingSlash: "ignore",
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
  i18n: {
    defaultLocale: "en",
    locales: ["en", "sv"],
    routing: {
      prefixDefaultLocale: false,
      redirectToDefaultLocale: false,
    },
  },
});

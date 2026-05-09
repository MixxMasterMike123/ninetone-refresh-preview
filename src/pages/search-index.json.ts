import type { APIRoute } from "astro";
import {
  getArtists,
  getPreviousArtists,
  getClients,
  getBookingRoster,
  getTeam,
  getNews,
} from "../lib/ninetone";

export type SearchSection =
  | "records"
  | "previous"
  | "management"
  | "nation"
  | "team"
  | "news";

export type SearchEntry = {
  section: SearchSection;
  name: string;
  blurb: string;
  tags: string[];
  href: string;
  image?: string;
};

function splitTags(v: unknown): string[] {
  if (!v) return [];
  return String(v).split(/\r|\n/).map((s) => s.trim()).filter(Boolean);
}

export const GET: APIRoute = async () => {
  const [artists, previous, clients, roster, team, news] = await Promise.all([
    getArtists().catch(() => []),
    getPreviousArtists().catch(() => []),
    getClients().catch(() => []),
    getBookingRoster().catch(() => []),
    getTeam().catch(() => []),
    getNews().catch(() => []),
  ]);

  const entries: SearchEntry[] = [];

  for (const a of artists) {
    const slug = String(a.SLUG ?? "");
    if (!slug) continue;
    entries.push({
      section: "records",
      name: String(a["Head Artist"] ?? ""),
      blurb: String(a.artistPresentationShort ?? ""),
      tags: splitTags(a.genre),
      href: `/records/artists/${slug}`,
      image: a.artistPicture_small ? String(a.artistPicture_small) : undefined,
    });
  }

  for (const a of previous) {
    const slug = String(a.SLUG ?? "");
    if (!slug) continue;
    entries.push({
      section: "previous",
      name: String(a["Head Artist"] ?? ""),
      blurb: String(a.artistPresentationShort ?? ""),
      tags: splitTags(a.genre),
      href: `/records/artists/previous/single/${slug}`,
      image: a.artistPicture_small ? String(a.artistPicture_small) : undefined,
    });
  }

  for (const c of clients) {
    const slug = String(c.SLUG ?? "");
    if (!slug) continue;
    entries.push({
      section: "management",
      name: String(c["Head Artist"] ?? ""),
      blurb: String(c.clientPresentationTitle ?? c.clientPresentationShort ?? ""),
      tags: splitTags(c.tags ?? c.genre),
      href: `/management/clients/${slug}`,
      image: c.artistPicture_small ? String(c.artistPicture_small) : undefined,
    });
  }

  for (const e of roster) {
    const slug = String(e.SLUG ?? "");
    if (!slug) continue;
    entries.push({
      section: "nation",
      name: String(e["Head Artist"] ?? ""),
      blurb: String(e.bookingPresentationTitle ?? e.bookingPresentationShort ?? ""),
      tags: splitTags(e.tags ?? e.genre),
      href: `/ninetone-nation/${slug}`,
      image: e.artistPicture_small ? String(e.artistPicture_small) : undefined,
    });
  }

  for (const m of team) {
    const slug = String(m.SLUG ?? "");
    if (!slug) continue;
    entries.push({
      section: "team",
      name: String(m.userNameCalc ?? ""),
      blurb: String(m.title ?? ""),
      tags: [],
      href: `/team/${slug}`,
      image: m.userPhotoSmall ? String(m.userPhotoSmall) : m.userPhoto ? String(m.userPhoto) : undefined,
    });
  }

  for (const p of news) {
    const slug = String(p.slug ?? "");
    if (!slug) continue;
    entries.push({
      section: "news",
      name: String(p.Title ?? ""),
      blurb: String(p.shortMessage ?? ""),
      tags: [],
      href: `/news/${slug}`,
      image: p.image_webp ? String(p.image_webp) : undefined,
    });
  }

  return new Response(JSON.stringify(entries), {
    headers: { "Content-Type": "application/json" },
  });
};

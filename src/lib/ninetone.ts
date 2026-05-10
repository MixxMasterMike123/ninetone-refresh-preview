/**
 * Ninetone domain wrappers around the FileMaker Data API.
 *
 * Field types are loose (Record<string, unknown>) until we have sample
 * responses — once we do, replace with strict shapes.
 */

import { fmFind, fmFindWithPortals } from "./filemaker";

export type Artist = Record<string, unknown> & {
  SLUG?: string;
  "Head Artist"?: string;
  artistPresentationShort?: string;
  /** Section-level intro text (markdown). Same value duplicated across all
   * rows on a given list endpoint. Field name varies per layout:
   *   API_ARTIST    → readMore
   *   API_Management → readMoreClients
   *   API_Booking   → readMoreBooking */
  readMore?: string;
  readMoreClients?: string;
  readMoreBooking?: string;
  "Artist Presentation Title"?: string;
  clientPresentationTitle?: string;
  bookingPresentationTitle?: string;
  filterActive?: string;
  filterType?: string;
};

export type ArtistDetail = Artist & Record<string, unknown>;

export type WebPost = Record<string, unknown> & {
  SLUG?: string;
  category?: string;
  title?: string;
  publishDate?: string;
};

export type TeamMember = Record<string, unknown> & {
  SLUG?: string;
  Active?: string;
  sortOrder?: string;
};

// API_ARTIST — roster list (Records active artists)
export function getArtists() {
  return fmFind<Artist>("API_ARTIST", {
    query: [
      {
        filterActive: "==Active",
        filterType: "Music",
        SLUG: "*",
        letterSearch: "==**",
        "Head Artist": "*",
      },
    ],
    sort: [
      { fieldName: "highLight_music", sortOrder: "descend" },
      { fieldName: "Head Artist", sortOrder: "ascend" },
    ],
  });
}

// API_ARTIST_DETAIL — single artist + portal data (releases, etc.)
export function getArtistBySlug(slug: string) {
  return fmFind<ArtistDetail>("API_ARTIST_DETAIL", {
    query: [{ filterActive: "==*", SLUG: slug }],
    limit: 1,
  }).then((rows) => rows[0]);
}

// Previous artists — same layout, "Not Active". 342 records as of writing,
// so we set a generous ceiling for build-time fetch.
export function getPreviousArtists() {
  return fmFind<ArtistDetail>("API_ARTIST_DETAIL", {
    query: [
      {
        filterActive: "==Not Active",
        filterType: "Music",
        SLUG: "*",
        artistPresentationShort: "*",
        "Head Artist": "==**",
      },
    ],
    sort: [{ fieldName: "Head Artist", sortOrder: "ascend" }],
    offset: "1",
    limit: 1000,
  });
}

// API_WEBPOSTS — section-level SEO content. Each FM record represents one
// section (Ninetone Group, Records, Management, Nation, Team, Blog) and the
// per-section text blocks live in the `webPost` portal table.
export type WebPostBlock = {
  subject: string;
  message: string;
  image?: string;
  date?: string;
  ytLinks: string[];
};

export type WebPostCategory = {
  category: string;
  title: string;
  blocks: WebPostBlock[];
};

export type WebPostSection =
  | "Ninetone Group"
  | "Ninetone Records"
  | "Ninetone Management"
  | "Ninetone Nation"
  | "Ninetone Group Team"
  | "Ninetone Blog";

function pickStr(row: Record<string, unknown>, key: string): string {
  const v = row[`webPost::${key}`];
  return v ? String(v) : "";
}

export async function getWebPosts(category: string = "*"): Promise<WebPostCategory[]> {
  const records = await fmFindWithPortals<{ category?: string; title?: string; readMore?: string }>(
    "API_WEBPOSTS",
    { query: [{ category }] },
  );

  return records.map((r) => {
    const portalRows = (r.portalData?.webPost ?? []) as Record<string, unknown>[];
    const blocks: WebPostBlock[] = portalRows
      .map((row) => ({
        subject: pickStr(row, "subject"),
        message: pickStr(row, "message"),
        image: pickStr(row, "image_webp") || undefined,
        date: pickStr(row, "date") || undefined,
        ytLinks: ["ytLinkA", "ytLinkB", "ytLinkC", "ytLinkD"]
          .map((k) => pickStr(row, k))
          .filter(Boolean),
      }))
      .filter((b) => b.subject || b.message);

    return {
      category: String(r.fieldData.category ?? ""),
      title: String(r.fieldData.title ?? ""),
      blocks,
    };
  });
}

/** Convenience: fetch one section by exact category name. */
export async function getWebPostSection(category: WebPostSection): Promise<WebPostCategory | null> {
  const all = await getWebPosts();
  return all.find((c) => c.category === category) ?? null;
}

// API_NEWS — news feed for /news, sorted newest-first
export function getNews() {
  return fmFind<WebPost>("API_NEWS", {
    query: [{ Message: "*" }],
    sort: [{ fieldName: "Date", sortOrder: "descend" }],
  });
}

/**
 * Get news posts that mention a specific artist.
 *
 * Originally one FM substring search per artist (~450 calls/build). We now
 * fetch the full news list once (cached) and filter locally — same case-
 * insensitive substring match FM does on the `Message` field.
 */
export async function getNewsForArtist(artistName: string, limit = 3): Promise<WebPost[]> {
  if (!artistName) return [];
  const all = await getNews();
  const needle = artistName.toLowerCase();
  return all
    .filter((p) => String(p.Message ?? "").toLowerCase().includes(needle))
    .slice(0, limit);
}

// API_USERS — team members
export function getTeam() {
  return fmFind<TeamMember>("API_USERS", {
    query: [{ Active: "==Ja", SLUG: "*" }],
    sort: [{ fieldName: "sortOrder", sortOrder: "ascend" }],
  });
}

// API_Management — management clients
export function getClients() {
  return fmFind<Artist>("API_Management", {
    query: [
      {
        filterActive: "==Active",
        filterTypeCombine: "Management",
        SLUG: "*",
        "Head Artist": "*",
      },
    ],
    sort: [
      { fieldName: "highLight_client", sortOrder: "descend" },
      { fieldName: "Head Artist", sortOrder: "ascend" },
    ],
  });
}

// API_Booking — Ninetone Nation entertainers (artists + förläsare)
export function getBookingRoster() {
  return fmFind<Artist>("API_Booking", {
    query: [
      {
        filterActive: "==Active",
        filterType: "Booking",
        SLUG: "*",
        filterTypeCombine: "==***",
        tagBooking: "*",
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// API_BOOKING_TAG — Nation booking categorized by tag (Artist / Föreläsare /
// Konferencier / Moderator / Underhållare / Influencer). Each FM record is one
// category, and the bookable artists for that category live in the
// `Green HeadArtist` portal table.
// ---------------------------------------------------------------------------

export type BookingCategoryArtist = {
  slug: string;
  name: string;
  imageBig?: string;
  imageSmall?: string;
  blurb: string;
  tagline: string;
  highlight: boolean;
  socials: {
    spotify?: string;
    apple?: string;
    youtubeMusic?: string;
    youtube?: string;
    instagram?: string;
    tiktok?: string;
    twitter?: string;
    facebook?: string;
  };
};

export type BookingCategory = {
  /** Category name (e.g. "Artist", "Föreläsare"). */
  tag: string;
  /** Swedish description blurb shown in the section head. */
  description: string;
  /** All bookable artists tagged with this category. May contain duplicates
   *  across categories — that's intentional, an artist bookable as both an
   *  Artist and a Föreläsare appears in both sections. */
  artists: BookingCategoryArtist[];
};

function pickPortal(row: Record<string, unknown>, key: string): string {
  const v = row[`Green HeadArtist::${key}`];
  return v ? String(v) : "";
}

export async function getBookingCategories(): Promise<BookingCategory[]> {
  const records = await fmFindWithPortals<{ tagBooking?: string; breadBooking?: string }>(
    "API_BOOKING_TAG",
    { query: [{ tagBooking: "*" }] },
  ).catch(() => []);

  return records.map((r) => {
    const portalRows = (r.portalData?.["Green HeadArtist"] ?? []) as Record<string, unknown>[];
    const artists: BookingCategoryArtist[] = portalRows
      .map((row) => ({
        slug: pickPortal(row, "SLUG"),
        name: pickPortal(row, "Head Artist"),
        imageBig: pickPortal(row, "artistPicture_big") || undefined,
        imageSmall: pickPortal(row, "artistPicture_small") || undefined,
        blurb:
          pickPortal(row, "bookingPresentationShort") ||
          pickPortal(row, "clientPresentationShort") ||
          pickPortal(row, "artistPresentationShort"),
        tagline:
          pickPortal(row, "bookingPresentationTitle") ||
          pickPortal(row, "clientPresentationTitle") ||
          pickPortal(row, "Artist Presentation Title"),
        highlight: pickPortal(row, "highLight_client") === "true",
        socials: {
          spotify: pickPortal(row, "url_spotify") || undefined,
          apple: pickPortal(row, "url_applemusic") || undefined,
          youtubeMusic: pickPortal(row, "url_youtube_music") || undefined,
          youtube: pickPortal(row, "url_youtube_link") || undefined,
          instagram: pickPortal(row, "url_instagram") || undefined,
          tiktok: pickPortal(row, "url_tiktok_artist") || undefined,
          twitter: pickPortal(row, "url_twitter") || undefined,
          facebook: pickPortal(row, "url_facebook") || undefined,
        },
      }))
      .filter((a) => a.slug && a.name);

    return {
      tag: String(r.fieldData.tagBooking ?? ""),
      description: String(r.fieldData.breadBooking ?? ""),
      artists,
    };
  });
}

// ---------------------------------------------------------------------------
// Phase 2 helpers — promo bar + featured pickers
// ---------------------------------------------------------------------------

export type Promo = {
  /** Short label, e.g. "New release", "On tour", "Just signed". */
  label: string;
  /** One-line message — artist + title etc. */
  message: string;
  /** Optional URL the bar should link to. */
  href?: string;
};

/**
 * Promo bar content. Looks for a WebPosts category named "Promo" and uses its
 * first block: subject = label, message line 1 = message, message line 2 = URL.
 * Returns null if the category doesn't exist or has no usable block — the
 * PromoBar component then renders nothing.
 */
export async function getPromo(): Promise<Promo | null> {
  // We allow either a literal "Promo" category or a typed string fallback.
  const all = await getWebPosts().catch(() => [] as WebPostCategory[]);
  const cat = all.find((c) => c.category.toLowerCase() === "promo");
  const block = cat?.blocks[0];
  if (!block || !block.subject) return null;

  // Message field may contain "Headline\nhttps://link" — split.
  const lines = String(block.message ?? "")
    .split(/\r\n|\r|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const message = lines.find((l) => !/^https?:\/\//i.test(l)) ?? "";
  const href = lines.find((l) => /^https?:\/\//i.test(l));

  if (!message) return null;
  return { label: block.subject, message, href };
}

/**
 * Top-N records artists, leveraging the existing highLight_music sort order
 * (already applied in getArtists). Returned as the home-page featured strip.
 */
export async function getFeaturedArtists(limit = 6): Promise<Artist[]> {
  const list = await getArtists().catch(() => [] as Artist[]);
  return list.slice(0, limit);
}

export async function getFeaturedClients(limit = 6): Promise<Artist[]> {
  const list = await getClients().catch(() => [] as Artist[]);
  return list.slice(0, limit);
}

export async function getFeaturedBooking(limit = 6): Promise<Artist[]> {
  const list = await getBookingRoster().catch(() => [] as Artist[]);
  return list.slice(0, limit);
}

/**
 * Pick "related" artists for a detail page strip — artists that share tags
 * with the current one, ranked by overlap. If there aren't enough overlap
 * matches to fill `limit`, top up with random others so the strip is never
 * sparse. The current artist is always excluded.
 *
 * `tagsOf` lets each division pass its own field extractor (Records uses
 * `genre`, Management uses `tags ?? genre`, Nation uses
 * `tagBooking ?? tags ?? genre`).
 */
export function pickRelatedArtists<T extends Record<string, unknown>>(
  current: T,
  pool: T[],
  tagsOf: (a: T) => string[],
  limit = 12,
): T[] {
  const currentSlug = String(current.SLUG ?? "");
  const currentTags = new Set(tagsOf(current).map((t) => t.toLowerCase()).filter(Boolean));

  const others = pool.filter((a) => String(a.SLUG ?? "") !== currentSlug);

  // Score each by tag overlap; keep matches > 0 sorted desc.
  const scored = others
    .map((a) => {
      const tags = tagsOf(a).map((t) => t.toLowerCase());
      const overlap = tags.reduce((n, t) => (currentTags.has(t) ? n + 1 : n), 0);
      return { artist: a, overlap };
    })
    .filter((s) => s.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap);

  const matched = scored.map((s) => s.artist);

  if (matched.length >= limit) return matched.slice(0, limit);

  // Top up with random non-overlapping others. Deterministic shuffle keyed on
  // the current slug so each detail page is stable across rebuilds.
  const matchedSlugs = new Set(matched.map((a) => String(a.SLUG ?? "")));
  const remaining = others.filter((a) => !matchedSlugs.has(String(a.SLUG ?? "")));

  // Mulberry32 PRNG seeded from the slug — deterministic per-page.
  let seed = 0;
  for (let i = 0; i < currentSlug.length; i++) seed = (seed * 31 + currentSlug.charCodeAt(i)) >>> 0;
  function rand() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const shuffled = [...remaining];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return [...matched, ...shuffled].slice(0, limit);
}

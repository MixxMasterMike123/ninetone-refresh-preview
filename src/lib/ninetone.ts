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
  const records = await fmFindWithPortals<{ category?: string; title?: string }>(
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

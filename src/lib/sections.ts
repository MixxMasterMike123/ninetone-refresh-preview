export type SectionTheme = "group" | "records" | "management" | "nation";

/**
 * Legacy chrome palette — full brand-color backgrounds with white text.
 * Retained for Footer (which still renders as a saturated brand band).
 * Header/Hero now use `sectionAccent` instead.
 */
export const sectionColors: Record<SectionTheme, { bg: string; text: string; cta: string }> = {
  group: {
    bg: "bg-ninetone-red",
    text: "text-white",
    cta: "bg-white text-ninetone-red hover:bg-neutral-100",
  },
  records: {
    bg: "bg-ninetone-red",
    text: "text-white",
    cta: "bg-white text-ninetone-red hover:bg-neutral-100",
  },
  management: {
    bg: "bg-ninetone-navy",
    text: "text-white",
    cta: "bg-white text-ninetone-navy hover:bg-neutral-100",
  },
  nation: {
    bg: "bg-ninetone-green",
    text: "text-white",
    cta: "bg-white text-ninetone-green hover:bg-neutral-100",
  },
};

/**
 * Paper-canvas accent palette — used by Header, Hero, and editorial chrome.
 * Page background stays paper/ink; the section identity comes through a single
 * accent color (button, underline, kicker mark).
 */
export const sectionAccent: Record<SectionTheme, {
  /** Hex for inline use (e.g. SVG fill, css var) */
  hex: string;
  /** Tailwind text utility */
  text: string;
  /** Tailwind border utility */
  border: string;
  /** Tailwind bg utility for solid accent buttons */
  bg: string;
  /** CTA button class (solid accent on paper) */
  cta: string;
  /** Display label for the division */
  label: string;
}> = {
  group: {
    hex: "#0a1420",
    text: "text-ninetone-ink",
    border: "border-ninetone-ink",
    bg: "bg-ninetone-ink",
    cta: "bg-ninetone-ink text-ninetone-paper hover:bg-ninetone-ink-soft",
    label: "Ninetone Group",
  },
  records: {
    hex: "#91000c",
    text: "text-ninetone-red",
    border: "border-ninetone-red",
    bg: "bg-ninetone-red",
    cta: "bg-ninetone-red text-ninetone-paper hover:bg-ninetone-red-dark",
    label: "Ninetone Records",
  },
  management: {
    hex: "#13486f",
    text: "text-ninetone-navy",
    border: "border-ninetone-navy",
    bg: "bg-ninetone-navy",
    cta: "bg-ninetone-navy text-ninetone-paper hover:bg-ninetone-navy-dark",
    label: "Ninetone Management",
  },
  nation: {
    hex: "#1a936f",
    text: "text-ninetone-green",
    border: "border-ninetone-green",
    bg: "bg-ninetone-green",
    cta: "bg-ninetone-green text-ninetone-paper hover:bg-ninetone-green-dark",
    label: "Ninetone Nation",
  },
};

export const sectionCta: Record<SectionTheme, { en: string; sv: string; href: string }> = {
  group: { en: "Demos", sv: "Demos", href: "/records/contact-records" },
  records: { en: "Demos", sv: "Demos", href: "/records/contact-records" },
  management: { en: "Ideas", sv: "Idéer", href: "/management/contact-management" },
  nation: { en: "Booking", sv: "Bokning", href: "/ninetone-nation/booking" },
};

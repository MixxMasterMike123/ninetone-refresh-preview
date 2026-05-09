export type SectionTheme = "group" | "records" | "management" | "nation";

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

export const sectionCta: Record<SectionTheme, { en: string; sv: string; href: string }> = {
  group: { en: "Demos", sv: "Demos", href: "/records/contact-records" },
  records: { en: "Demos", sv: "Demos", href: "/records/contact-records" },
  management: { en: "Ideas", sv: "Idéer", href: "/management/contact-management" },
  nation: { en: "Booking", sv: "Bokning", href: "/ninetone-nation/booking" },
};

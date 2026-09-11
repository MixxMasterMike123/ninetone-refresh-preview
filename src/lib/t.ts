/**
 * Call-site wrapper around src/lib/translate.ts's `createT()`, for Section 4
 * of docs/i18n-phase-2-brief.md ("replace the scattered `lang === "sv" ? … :
 * …` ternaries ... with `t(text)` calls").
 *
 * This file exists to close TWO gaps that only became visible once `t()` was
 * actually wired into real pages/components — both are call-site problems,
 * not translate.ts problems, and translate.ts is out of scope for section 4
 * (see docs/i18n-phase-2-brief.md's file-ownership list), so the fix has to
 * live here instead of there.
 *
 * GAP 1 — ONE BUDGET PER RENDER, NOT ONE BUDGET PER COMPONENT.
 * `createT(locals)` with no `opts.budget` constructs a FRESH `RequestBudget`
 * (default ceiling 25) every time it's called (translate.ts's own doc
 * comment on `createT` says this explicitly). Every page on this site routes
 * through Base.astro, which mounts Header + Footer + CommandPalette as
 * siblings of the page's own content — if each of those called
 * `createT(Astro.locals)` independently with no shared budget, the render
 * would get Header's-own-25 + Footer's-own-25 + CommandPalette's-own-25 +
 * the page's-own-25 = up to 100 uncached calls allowed on one render, four
 * times the ceiling the brief's Build item actually specifies ("max 25
 * uncached calls per render"). `sharedT()` below fixes this by stashing ONE
 * `RequestBudget` on `Astro.locals` (the one object every component in a
 * render tree already shares — src/middleware.ts relies on this same fact
 * for `locals.lang`) and handing that same instance to every `createT()`
 * call for the request, via `opts.budget`.
 *
 * GAP 2 — IDENTICAL STRINGS REPEATED MANY TIMES IN ONE RENDER MUST NOT EACH
 * CONSUME A BUDGET SLOT. `ArtistCard`'s `ctaLabel` prop is the clearest
 * example: src/pages/ninetone-nation/booking.astro renders one `ArtistCard`
 * per active booking talent (`getBookingCategories()` queries with `limit:
 * 100`, src/lib/ninetone.ts) and passes the literal string `"Book"` to every
 * one of them. Naively calling `t("Book")` once per card would mean up to
 * ~100 independent `translate()` calls for the SAME source string on ONE
 * render of ONE page — each an independent cache/override lookup, and on a
 * cold cache each independently burning a budget slot for what is, in
 * effect, one distinct string. `sharedT()` memoizes by source string WITHIN
 * one call to the returned `t`, so "Book" is translated (or scheduled) once
 * per render no matter how many cards ask for it, and every other caller
 * gets the same in-flight promise instead of issuing a duplicate call.
 *
 * WHY NOT JUST FIX THIS IN `createT()` ITSELF: translate.ts is explicitly
 * out of scope for section 4 (docs/i18n-phase-2-brief.md's "Do NOT touch"
 * list) — if it needed a change, the instruction is to stop and report
 * rather than edit it. Both gaps above are fixable entirely at the call
 * site, using only `createT()`'s existing public `opts.budget` and
 * `opts.protect` parameters, so no change to translate.ts was needed.
 */

import { createT, RequestBudget, type Lang, type TFunction } from "./translate.ts";

/**
 * Shape this module needs from `Astro.locals`. Deliberately structural (see
 * translate.ts's own `LocalsWithScheduler` for the same reasoning) — no
 * `App.Locals` type exists anywhere in this codebase.
 */
interface LocalsForT {
  lang?: Lang;
  cfContext?: { waitUntil?: (promise: Promise<unknown>) => void };
  /** Stashed by `sharedT()` on first use per request — see GAP 1 above. */
  __i18nBudget?: RequestBudget;
}

/**
 * Per-request memo table, keyed off the SAME `locals` object every component
 * in a render shares. A `WeakMap` (not a plain object on `locals` itself)
 * so this module never mutates the shape of `Astro.locals` with anything
 * other than the one budget field it already owns, and so entries are
 * automatically released once a request's `locals` object is garbage
 * collected — no manual per-request cleanup needed. Keyed by locals identity
 * rather than a request id because nothing in this codebase threads a
 * request id through today, and `locals` already IS the one-per-request
 * object every call site has in hand.
 */
const memoTables = new WeakMap<object, Map<string, Promise<string>>>();

/**
 * The one call site every page/component should use instead of calling
 * `createT()` directly (docs/i18n-phase-2-brief.md section 4's wiring
 * choice — see the PR description for the full "why `Astro.locals` over a
 * threaded `t` prop" reasoning). Pass `Astro.locals` straight through.
 *
 * Returns a `TFunction` (`(source: string) => Promise<string>`) exactly like
 * `createT()` does — this is a drop-in wrapper, not a different API — so
 * every call site still reads as `await t("Some copy")`.
 */
export function sharedT(
  locals: LocalsForT,
  opts?: {
    protect?: string[];
    /**
     * Render this text in THIS language regardless of `locals.lang`.
     *
     * For the one caller that knows the target better than `locals` does:
     * src/pages/llms.txt.ts serves both /llms.txt and (via the middleware
     * rewrite) /en/llms.txt, and its gh-target sibling passes "en"
     * explicitly. That endpoint previously expressed this as
     * `sharedT({ ...locals, lang })` — which quietly defeated BOTH of this
     * module's reasons to exist: the spread makes a NEW object, so the
     * budget stashed on it is private to that call and the memo WeakMap
     * (keyed by `locals` identity) gets its own empty table. Overriding the
     * target here instead keeps the one real `locals` object, and with it
     * the one shared budget and memo, exactly as note C requires.
     */
    lang?: Lang;
  },
): TFunction {
  const l = locals as LocalsForT;
  // GAP 1 fix: create the budget once per request, reuse thereafter. `locals`
  // is the same object for every component in this render (Astro shares one
  // `Astro.locals` across a whole request, including nested components —
  // src/middleware.ts already depends on this for `locals.lang`), so
  // stashing state here is the one place available that doesn't require
  // threading a new prop through every component signature in the app.
  if (!l.__i18nBudget) {
    l.__i18nBudget = new RequestBudget();
  }
  const budget = l.__i18nBudget;

  // The override is passed through as a locals-SHAPED argument to createT
  // (which reads `.lang` off it) while the budget and memo below still key
  // off the real `locals` — so an override changes the target language
  // without forking per-request state.
  const forTarget = opts?.lang ? { ...locals, lang: opts.lang } : locals;
  const baseT = createT(forTarget, { protect: opts?.protect, budget });

  // GAP 2 fix: memoize by exact source string for the lifetime of this
  // request's `locals` object. Concurrent callers awaiting the same source
  // string share one in-flight promise rather than each independently
  // calling `translate()` (which would otherwise mean each one separately
  // hashes the string, checks the override file, checks KV, and — on a
  // cache miss — separately calls `budget.tryConsume()`, burning multiple
  // slots on what is semantically one distinct translation job).
  let table = memoTables.get(l);
  if (!table) {
    table = new Map();
    memoTables.set(l, table);
  }
  const memo = table;

  return (source: string): Promise<string> => {
    const cached = memo.get(source);
    if (cached) return cached;
    // .catch here rather than relying on translate() never throwing: the memo
    // stores the promise BEFORE it settles, so a single rejection would be
    // replayed to every later caller in the render with no retry — and since
    // this now runs on every page, that failure would be silent and total.
    // Falling back to the source string makes the module's contract ("never
    // block, never blank a page") explicit at the memo layer instead of an
    // inherited property of translate.ts that a future edit could regress.
    const job = baseT(source).catch(() => source);
    memo.set(source, job);
    return job;
  };
}

// Centralised thresholds and summary rules.
// All numeric values are in the same unit as the relevant score (0–100 for RT, 0–10 for IMDb/TMDB).

const RatingsConfig = {
  // Minimum confidence to render an RT score at all
  confidenceThreshold: 0.7,

  // Which revision of the title-matching rules produced a cached score. Both
  // caches store the confidence their lookup earned, and neither re-runs the
  // matcher on a hit, so a change to normalisation or scoring would otherwise
  // leave every cached title wearing the verdict the old rules reached.
  // Bump this whenever anything changes what a cached entry means — title
  // normalisation, match scoring, or the rules deciding what is worth storing.
  // Entries stamped with anything else are looked up again.
  //
  // 3: version 2 could record a failed lookup as "nothing knows this title",
  //    because a worker that could not answer and a worker answering "no match"
  //    both produced a null bundle. Those absences hide real scores, and there
  //    is no way to tell them apart after the fact, so they are all discarded.
  matcherVersion: 3,

  // Thresholds for quality summary heuristics (RT critics %)
  summary: {
    criticsCertifiedFresh: 75,   // "Critics love it"
    criticsStrong:         60,   // "Strong reviews"
    criticsMixed:          40,   // "Mixed reviews"
    // Below 40 → "Mostly negative reviews"
  },

  // Audience vs critics delta for the "Audience disagrees" summary
  audienceCriticsDelta: 15,  // e.g. audience 80, critics 60 → "Audience likes it more"

  requestTimeoutMs: 10000,

  // No single lookup may hold a card hostage: if the whole resolution has not
  // settled by then, the title is treated as inconclusive (retried soon, never
  // stored) and the late answer is dropped. Without this a hung message
  // channel pins the coalesced promise forever and the badge never appears.
  resolveTimeoutMs: 30000,

  // Two caches, bounded separately: they hold different-sized entries under
  // different expiry rules, and each persists as one rewritten blob, so the
  // cap is also what decides how large that write gets.
  //
  // The overlay ratings cache has no expiry by design, so this cap is its only
  // bound; eviction is least-recently-used.
  // Seerr's two ratings endpoints share one backend, so where that backend is
  // unreachable both 404 for every title. Stop asking after this many
  // consecutive failures across the pair; any success resets it, and a refresh
  // gives them another chance.
  seerrRatingsFailureLimit: 12,

  // How long "nothing knows this title" stands before it is worth asking again.
  // Not remembering it at all meant a fresh round of requests, and a fresh 404
  // from Seerr's ratings endpoints, on every visit to the same page. A film
  // that nobody has rated yet is unrated only for now, so this expires.
  unratedRetryMs: 7 * 24 * 60 * 60 * 1000,

  // A lookup that could not complete is not a verdict, so it is not stored the
  // same way: it is held in memory only, briefly, so the badges on a page do
  // not re-ask on every injection pass while a server is down or the worker is
  // restarting. It never reaches storage and never outlives the page.
  inconclusiveRetryMs: 2 * 60 * 1000,

  // "Load 500 more" asks Seerr for this many further cards before scoring them.
  // Seerr paginates twenty at a time and only in response to a real scroll
  // event, so this is a target and not a guarantee: a shorter list ends the run
  // early. The overlay cache holds 5000 entries, so a few runs fit comfortably.
  bulkLoadTarget: 500,
  // How long to wait for a scroll to produce more cards before deciding the
  // list has ended. Seerr debounces the scroll handler and then fetches.
  bulkLoadWaitMs: 4000,
  // Scoring runs in batches, so a self-hosted Seerr is not asked about five
  // hundred titles at once. Rotten Tomatoes has its own smaller limit.
  bulkScoreBatch: 6,

  overlayCacheMaxEntries: 5000,
  // The persisted title index that lets a cold load identify cards before
  // Seerr's own lists arrive. One entry is an id, a type, a title and a poster
  // path, so a couple of thousand fit in a few hundred kilobytes.
  listIndexMaxEntries: 2000,
  // Rotten Tomatoes lookups do expire, so this only bounds a browsing session.
  rtCacheMaxEntries: 5000,
  // Rotten Tomatoes sits behind bot protection and answers a burst of lookups
  // with 403 for a while. A grid of fifty cards would keep asking through the
  // whole block, which cannot succeed and invites a longer one, so stop after a
  // run of transport failures and let it recover. Nothing is cached as unrated
  // meanwhile: a refused request is not a verdict on the title.
  // One card's lookup is one or two page fetches, and a grid resolves fifty
  // cards at once. Fifty simultaneous requests is the shape bot protection is
  // built to notice, and nothing here is urgent enough to need them all at
  // once, so they queue.
  rtMaxConcurrent: 3,
  rtFailureLimit: 5,
  rtBackoffMs: 5 * 60 * 1000,

  rtNegativeCacheTtlMs: 60 * 60 * 1000,
  rtCacheTtlMs: 24 * 60 * 60 * 1000,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RatingsConfig;
} else {
  globalThis.RatingsConfig = RatingsConfig;
}

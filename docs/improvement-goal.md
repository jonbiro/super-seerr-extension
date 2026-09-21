# Super Seerr improvement goal: completion audit

All eleven implementation requirements are delivered. This audit checks the
production code, behavior tests, browser results, build contents, and published
Git state. Browser fixtures, live pages, local builds, and store releases are
separate evidence categories.

## Requirement evidence

| # | Delivered behavior | Production source | Verification inspected |
| --- | --- | --- | --- |
| 1 | Cached scores render immediately; full scores refresh after 24h, partial scores after 1h, unrated titles after 6h, failed lookups after 2m; failures retain known scores | `src/content/seerr-integration.js`, `OverlayCache.js`, `src/shared/RatingsConfig.js` | `tests/ratings-freshness.test.js`, `ratings-refresh.test.js`, `unrated-titles.test.js`; Chromium delayed refresh renders 10% before updating to 85% |
| 2 | Concurrent status calls share reads; history/detail reads cache for 10s and statuses for 15s; writes and settings changes invalidate cached and in-flight results | `src/background/SeerrReadCache.js`, `SeerrTransport.js`, `background.js` | `tests/seerr-read-cache.test.js`: same/different identities, expiry, rejected reads, failed writes, settings races, 200-entry bound |
| 3 | Semantic flyout button, expanded-state announcements, inert collapsed panel, focus handling, Escape and close-button support | `src/shared/UIComponents.js` | `tests/flyout-accessibility.test.js`; Chromium Enter/Space/Escape and SPA flyout tests |
| 4 | TV season review shows standard-quality availability, requires explicit choices, and refreshes availability before sending one request | `src/shared/SeasonPicker.js`, `BaseIntegration.js`, `src/background/SeasonRequests.js`, `src/content/seerr-integration.js` | `tests/season-requests.test.js`, bulk DOM test; Chromium exact POST contains only season 2; Firefox picker works. Cancellation, navigation, changed availability/server, disabled and invalid selections tested |
| 5 | Card/detail explanations distinguish unrated, failed and uncertain lookups; display source and last-checked time; retry only the selected title | `src/content/seerr-integration.js`, `src/background/RottenTomatoes.js` | Freshness diagnostic tests; `tests/dom-integration.test.js` scoped retry verifies one extra request and the exact title; Chromium visible details and retry control |
| 6 | Popup separately diagnoses Seerr connectivity, host permission, API key and Plex; repair links focus the relevant Settings field | `src/background/PopupDiagnostics.js`, `src/popup/popup.js`, `src/options/options.js` | `tests/popup-diagnostics.test.js`, `popup-runtime.test.js`; Chromium repair focus and permission repair; Firefox popup runtime checks |
| 7 | Content cache access goes through an origin/path/frame/extension-validated worker bridge; bounded allowlisted data and epochs serialize writes/clears; local storage is trusted-only where supported | `src/background/OverlayStorage.js`, `background.js`, `src/content/OverlayCache.js` | `tests/overlay-storage.test.js`, cache-clear tests; Chromium denies content-script secret reads while cache/notifications work; Firefox bridge works with its documented API limitation |
| 8 | Real extension tests cover seven origins, Firefox, and upgrades from actual 3.5.2 source; copied implementation tests replaced with production execution | `tests/browser/`, production worker/DOM helpers | 20 Chromium tests; Firefox 147.0.3 with geckodriver 0.37.1; eleven movie/TV fixtures per browser; saved-settings/key-migration upgrades in both browsers. Chromium also checks retained permissions and updated dynamic registrations. Nine simulated suites replaced |
| 9 | Named filter presets save, apply, update and delete sorting/score thresholds in sync storage, with validated fields and a 20-preset limit | `src/content/FilterPresets.js`, `seerr-integration.js` | `tests/dom-integration.test.js` verifies stored fields, restored sort/thresholds, visible filtering and deletion |
| 10 | The popup shows the last 50 confirmed requests/watchlist additions, stored locally and clearable; only allowlisted fields are retained and credentials are redacted | `src/background/RecentActions.js`, `background.js`, `src/popup/recent-actions.js` | `tests/recent-actions.test.js`: concurrent writes, bound, restart, secret exclusion, rejected content access, safe rendering and clear. Storage failure preserves successful server outcomes; Chromium/Firefox popup coverage |
| 11 | Ambiguous matches require an explicit title choice, fresh status lookup and separate request click; no first-result guessing | `src/background/SeerrMatching.js`, `src/shared/UIComponents.js`, `BaseIntegration.js` | `tests/title-picker.test.js`, request-safety tests; Chromium selects the 2011 title and sends exactly its TMDB ID only after confirmation; Firefox selection, DOM focus/cancel/escaping |

## Preserved invariants

- Legacy URL/key migration and existing settings survive real-version upgrades.
  Credentials remain device-local. `tests/migration.test.js`,
  `api-key-storage.test.js`, and both browser upgrade paths exercise this.
- Safe title/type/year identity matching remains in the worker. Invalid IDs,
  mismatched titles and ambiguous results cannot authorize writes.
  `tests/request-safety.test.js` executes the production matching/request paths.
- Writes are never automatically retried, including lost replies and failed
  history persistence. `tests/request-retry.test.js` and `recent-actions.test.js`
  verify exact call counts and unknown-outcome messages.
- Build patch increments remain owned by `make build`. v3.5.10 was built for
  Chromium and Firefox; all 42 source files match each target byte-for-byte.
  The source manifest, package metadata, lockfile and README version agree.
- Project work was committed and pushed through `b5489ab`; unrelated user
  artifacts, including the excluded Puppy_Dash_Basecamp directory, were not
  included in the work. The checkout was clean before this audit document update.

## Verification results and limits

- [CI passed for implementation commit b5489ab](https://github.com/jonbiro/super-seerr-extension/actions/runs/35558803506), including source checks, tests, Chromium and both builds.
- Local source/manifest checks passed; all 489 unit/DOM/property tests passed.
  The lower count than the earlier 491 suite reflects replacement of simulated
  tests, not disabled tests: zero failures, skips or cancellations.
- All 20 Chromium browser tests passed. The separate Firefox suite passed its
  permission, injection, SPA/reload, cache, popup, picker, eleven-site-fixture and
  upgrade assertions. These use isolated profiles and synthetic pages.
- Read-only live Chromium checks passed expected title extraction on TMDB,
  Letterboxd, Rotten Tomatoes, Metacritic, Trakt and Filmweb. IMDb returned HTTP
  403, so its live media page is unverified. Its error page now creates no false
  movie flyout; production extraction regressions cover error/challenge titles.
  Trakt's generic application title also no longer becomes a movie identity.
- Live checks cover one movie page per site, not every route, authenticated
  request flow or TV variant. No real Seerr request was sent by these checks.
  Reproduce with `node tests/browser/live-sites.cjs`; blocked/failed sites produce
  a nonzero exit code and are listed separately in `test-results/live-sites.json`.
- Firefox 147.0.3 does not expose `storage.local.setAccessLevel`. The worker
  bridge functions there, but API-enforced local-storage isolation is unavailable.
  Chromium's restriction was verified in its actual content-script context.
- These are local builds and temporary test installations. No Chrome Web Store,
  Firefox Add-ons publication, or installation into the user's daily browser is
  claimed or required by this goal.

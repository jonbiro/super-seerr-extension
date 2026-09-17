# Changelog

All notable changes to the Super Seerr extension will be documented in this file.

## [3.1.12]

- Fixed release-year extraction, which used a hardcoded `1[8-9]\d{2}|20[0-2]\d` range and would have silently stopped recognising years from 2030. The plausible range is now derived from the clock, so there is no cliff. The metadata path also accepted any four-digit run, reading `2160` out of `2160p`; both paths now share one bounded, word-anchored helper.
- Fixed a timer leak on all seven supported sites. `BaseIntegration.destroy()` existed but nothing ever called it, so the one-second SPA navigation poller and the popstate listener outlived the page. The poller is now released on `pagehide` and re-armed on `pageshow`.
- Fixed navigation detection for a second integration instance on one page: the double-patch guard returned early and skipped the per-instance popstate listener and polling fallback, not just the history patch it was meant to guard.
- `window.seerr_debug.<site>.mediaData` is a live getter rather than a snapshot taken before the first navigation.
- Added a jsdom harness for the shared content-script layer, which previously had no direct test coverage.

## [3.1.11]

Breaking for existing installs: the extension now asks for permission to run on your Seerr server, and the API key stops syncing between devices.

- The ratings overlay no longer runs on every site. The catch-all content script and the all-sites host permissions are gone; the overlay is registered at runtime against the one origin you save, behind an optional host permission requested when you save it. Declining still saves your settings and shows a standing **Grant access** notice in Settings.
- Rotten Tomatoes results now persist in local storage instead of a worker-memory map. MV3 evicts the worker after seconds of idle, so the configured 24-hour TTL previously expired on eviction and every revisit re-scraped two pages per title.
- The API key moved from synced storage to device-local storage and is migrated automatically on upgrade; it must be re-entered once on each additional device. The overlay no longer reads the key at all and asks the worker whether requests are available.
- The background worker is quiet by default. Roughly a hundred unconditional `console.log` calls, including full media payloads and per-variation search traces, are now behind an opt-in `debugLogging` flag. Errors still surface.
- Removed the unused `activeTab` permission; added `scripting`.
- Fixed the Firefox manifest to use `background.scripts` with `type: module` rather than the `service_worker` entry Firefox ignores. Still unvalidated on a running Firefox.
- Fixed a seed-dependent flaky property test that generated `NaN` ratings and asserted they round-tripped.
- Added CI running the syntax check, tests, and both browser builds; `npm run check` now also validates the dynamically registered overlay files and the permission shape.

## [3.1.10]

- Resolve poster-only Seerr cards using unique, exact poster paths from the session list API, so ratings and sorting work before titles or links appear.
- Added a regression with shuffled API results and an unidentified poster.

## [3.1.9]

- Fixed sorting on Seerr movie grids whose title cards are nested inside list items. Controls now target the complete list, and sorting, filtering, and Reset preserve card wrappers.
- Added a regression covering the live Seerr list structure, coverage counts, filtering, Reset, and disabling the overlay.

## [3.1.8]

- Added explicit saved overlay preferences and non-saving connection tests.
- Separated embedded/list ratings by movie/TV identity and preserved server base paths.
- Handled query-only navigation, cleanup, and page restoration.
- Added request deadlines, RT lookup coalescing, bounded caches, and invalid-score handling.
- Kept sorting available with badges hidden; improved keyboard selection and cancellable bulk dialogs.
- Added production DOM regressions, syntax/manifest checks, a committed dependency lockfile, and documentation in build packages.
- Replaced obsolete migration plans with current architecture, requirements, verification, and troubleshooting documentation.

## [3.1.5]

- Corrected historical migration examples to preserve active settings and shared client files.
- Clarified that ratings-only mode requires saving a server URL.
- Corrected documentation of worker initialization and Firefox compatibility.

## [3.1.4]

- Published project metadata and issue links for Super Seerr under jonbiro/super-seerr-extension.
- Removed obsolete branding screenshots and updated naming in the retained historical implementation documentation.
- Included the MIT license in build and release packages.
- Retained compatibility settings migration and required license attribution.

## [3.1.2]

- Named the extension Super Seerr across the manifest, popup, options, and flyout.
- Added automatic patch-version increments for builds and releases.
- Kept RT sorting active as ratings arrive; added stable original-order restoration.
- Fixed partial ratings, confidence handling, ratings-only status, and worker initialization.

## [3.0.0] - 2025-06-06

### ✨ Features

- **RT Ratings Overlay on Seerr**: Rotten Tomatoes scores injected on Seerr browse cards and detail pages so you can evaluate titles at the point of request. Preferences Seerr-native ratings data first; falls back to confidence-aware resolution.
- **RT-Based Sorting & Filtering**: Sort browse/search results by RT critics or audience score; filter by minimum critics/audience thresholds. Unrated titles pushed to the bottom.
- **Bulk List Actions**: Multi-select titles on Seerr browse/search pages and submit them as a single reviewed batch request. Confirmation modal with excluded-titles review.
- **Add to Watchlist**: Secondary button in the flyout panel to add media directly to your Seerr watchlist.
- **In-Library Badge**: Green checkmark badge next to the media title when content is already available on Jellyfin.
- **Browser Toolbar Badge**: Green "ON" / Red "OFF" indicator on the extension icon showing connection state.
- **Feature Flags**: Card badges, detail-row injection, pre-request summary, sort/filter, and bulk actions individually gateable without code changes.

### Naming and compatibility

- Standardized the SeerrClient shared library and SeerrAPI worker class.
- Migrated stored connection settings while preserving backward compatibility.
- Updated extension metadata, options, and popup presentation.
- Preserved Jellyfin media-server links.

### 🏗️ Architecture

- **ES Modules**: Background service worker uses `type: module` with asynchronous initialization. Listeners register synchronously; messages wait for settings
- **Firefox MV3**: The Firefox manifest retains `service_worker`; this remains an unresolved runtime compatibility limitation, as described in README
- **Native Promise API**: All `chrome.runtime.sendMessage` calls use native Promise-based API (~12 callback wrappers eliminated)
- **Shared Ratings Model**: `RatingsModel.js` (typed bundle with partial-data support) and `RatingsConfig.js` (centralized thresholds)
- **Seerr Overlay CSS**: `seerr-overlay.css` injected via manifest `css` array — matches Seerr's visual density, supports dark/light themes
- **Session Cache**: In-memory ratings cache with request coalescing (only 1 in-flight lookup per TMDB ID)

### 🧪 Test Infrastructure

- **33 tests passing**: Property-based tests (fast-check) + smoke tests + DOM-level regression tests
- `package.json` with `node --test` runner
- `tests/helpers/chrome-mock.js`: in-memory `chrome.storage.sync` mock for property testing
- Tests cover: storage migration (round-trip + idempotence), branding (current-brand consistency), debug namespace, tmdbId passthrough, watchlist visibility & POST body, badge idempotence, ratings model renderability, cache coalescing, summary heuristic, overlay injection idempotence, SPA navigation regression

### 🐛 Bug Fixes

- **Service worker init race**: Listeners now registered synchronously at top level — no lost messages on worker wake
- **Duplicate flyout**: `setupFlyoutUI` method overwrite fixed; `updateStatus` restored
- **Request button debounce**: Double-click protection prevents duplicate requests
- **Ratings cache poisoning**: Rejected promises no longer permanently block cache entries
- **Bulk request response check**: Checks `response.success` before counting requests as succeeded
- **IMDB selector**: Added resilient fallback for hashed CSS module class
- **Sort stability**: Identical scores use card index as tiebreaker
- **Memory leak**: `window.seerr_debug` entries cleaned up in `destroy()`
- **Polling leak**: Navigation interval stops on cleanup via `destroyed` flag
- **Options URL validation**: Rejects non-http/https protocols
- **24 additional bugs** found and fixed during two comprehensive forensic audits

### 🔧 Technical

- **TMDB ID passthrough**: `requestMedia()` accepts direct TMDB ID, skipping title search entirely
- **Bulk request rate limiting**: 500ms delay between sequential requests with live progress counter
- **SPA navigation**: Overlay re-injects on client-side route changes without duplicating elements
- **`innerHTML` → `textContent`**: Rating items built with DOM APIs; user-controlled text escaped in bulk confirmation modal
- **Error handling**: Unhandled Promise rejections eliminated from `setTimeout` callbacks; `.catch()` added to all `.then()` chains

---

## [2.0.0] - 2025-10-15

### ✨ Features
- **6-Site Integration**: Complete support for IMDb, Rotten Tomatoes, TheMovieDB, Letterboxd, Metacritic, and Trakt
- **Unified Flyout Interface**: Consistent design across all supported sites
- **Brand Theming**: Each site maintains its unique visual identity and colors
- **Smart Media Detection**: Automatic extraction of title, year, and media type from page content
- **Real-time Status**: Shows current request status with color-coded indicators
- **Intelligent Retry Logic**: Handles network issues and connection failures gracefully

### 🏗️ Architecture
- **Shared Library System**: Modern modular architecture using BaseIntegration, SeerrClient, MediaExtractor, and UIComponents
- **Manifest V3**: Full compliance with latest browser extension standards
- **Service Worker**: Background script handling for improved performance
- **Cross-Site Consistency**: Unified behavior and styling patterns

### 🎨 User Experience
- **Status Indicators**: Green (available), Orange (pending), Blue (downloading), Red (error)
- **Responsive Design**: Flyout adapts to different screen sizes
- **Clean Interface**: Minimal, non-intrusive design that doesn't interfere with website experience
- **Fast Performance**: Optimized for quick loading and low resource usage

### 🔧 Technical
- **Enhanced Error Handling**: Comprehensive error recovery and user feedback
- **API Integration**: Full integration with Seerr REST API
- **Multi-domain Support**: Works across all major movie/TV platforms
- **Development Framework**: Easy expansion system for adding new sites

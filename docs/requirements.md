# Requirements Document

## Introduction

This feature migrates the browser extension from "Jellyseerr" branding to "Seerr" branding. The migration is purely cosmetic and structural — it does not alter any API endpoints (`/api/v1/...`) or Jellyfin-related functionality. The scope covers: renaming classes and files, updating storage keys with transparent backward-compatible migration, replacing all user-visible strings, updating manifest metadata, renaming the debug namespace, and updating project-level files (README, CHANGELOG, Makefile). Existing users must experience zero disruption; their stored configuration must be silently migrated on first startup after the update.

## Structure Note

Requirements are grouped into four phases:

- **Phase 1 — Core Migration (Requirements 1–10, 13–14, 34):** All rebranding changes needed before new features can safely be built on top.
- **Phase 2 — New Features (Requirements 11–12):** The watchlist button and in-library badge, built on the migrated codebase.
- **Phase 3 — Project-Level Updates (Requirements 32–33):** README, CHANGELOG, Makefile, and test infrastructure.
- **Phase 4 — Ratings Overlay Epic (Requirements 15–31):** The Seerr pre-request ratings overlay (implemented after core migration is complete).

Requirements 13 and 14 are in Phase 1 because the init guard fixes are a direct consequence of the class rename (Req 4) and the tmdbId fix is a prerequisite for both the watchlist button (Req 11) and the ratings overlay (Req 15+).

## Glossary

- **Extension**: The browser extension being migrated (Chrome/Firefox).
- **Background Script**: `src/background/background.js` — the service worker that manages API calls and storage.
- **SeerrAPI**: The renamed background-script class, formerly `JellyseerrAPI`.
- **SeerrClient**: The renamed shared client class in `src/shared/SeerrClient.js`, formerly `JellyseerrClient`.
- **Storage Migration**: The one-time, silent process of reading old storage keys (`jellyseerrUrl`, `jellyseerrApiKey`) and writing their values to new keys (`seerrUrl`, `seerrApiKey`), then deleting the old keys.
- **Old Storage Keys**: `jellyseerrUrl` and `jellyseerrApiKey` — the Chrome sync storage keys used before migration.
- **New Storage Keys**: `seerrUrl` and `seerrApiKey` — the Chrome sync storage keys used after migration.
- **Manifest**: `manifest.base.json`, `manifest.chrome.json`, and `manifest.firefox.json` — the WebExtension manifest files.
- **Content Script Entry**: A file path reference within a `content_scripts[].js` array in the Manifest.
- **Debug Namespace**: The `window.jellyseerr_debug` object used for developer debugging, renamed to `window.seerr_debug`.
- **Jellyfin**: An unrelated media server whose branding (`Watch on Jellyfin`, `/Jellyfin/`) is explicitly preserved and not changed.

---

## Phase 1: Core Migration

### Requirement 1: Storage Key Migration

**User Story:** As an existing user, I want my saved server URL and API key to be automatically carried over to the new storage keys, so that I do not have to re-enter my settings after updating the extension.

#### Acceptance Criteria

1. WHEN the Background Script initialises and `jellyseerrUrl` is present in `chrome.storage.sync`, THE Background Script SHALL read the value of `jellyseerrUrl`, write it to `seerrUrl`, and then delete `jellyseerrUrl` from `chrome.storage.sync`.
2. WHEN the Background Script initialises and `jellyseerrApiKey` is present in `chrome.storage.sync`, THE Background Script SHALL read the value of `jellyseerrApiKey`, write it to `seerrApiKey`, and then delete `jellyseerrApiKey` from `chrome.storage.sync`.
3. WHEN the Background Script initialises and neither `jellyseerrUrl` nor `jellyseerrApiKey` is present in `chrome.storage.sync`, THE Background Script SHALL skip the migration step without error.
4. WHEN the Storage Migration completes, THE Background Script SHALL load the active configuration from `seerrUrl` and `seerrApiKey`.
5. IF the Storage Migration fails due to a storage access error, THEN THE Background Script SHALL log the error and continue loading settings from any already-present `seerrUrl` and `seerrApiKey` values.
6. THE Background Script SHALL perform the Storage Migration before registering the `chrome.storage.onChanged` listener so that the listener only observes New Storage Keys.

### Requirement 2: Storage Key Rename Across All JS Files

**User Story:** As a developer, I want all JavaScript files to read and write only the new storage keys, so that the codebase is internally consistent after the migration.

#### Acceptance Criteria

1. THE Background Script SHALL use `seerrUrl` and `seerrApiKey` as the sole storage key names for all `chrome.storage.sync.get` and `chrome.storage.sync.set` calls.
2. THE Background Script SHALL observe only `seerrUrl` and `seerrApiKey` within the `chrome.storage.onChanged` listener.
3. THE Extension options page script (`options.js`) SHALL read and write `seerrUrl` and `seerrApiKey` exclusively in all `chrome.storage.sync` calls.
4. THE Extension popup script (`popup.js`) SHALL read `seerrUrl` and `seerrApiKey` exclusively in all `chrome.storage.sync.get` calls.

### Requirement 3: Class Rename — SeerrAPI

**User Story:** As a developer, I want the background-script class to be named `SeerrAPI`, so that the source code reflects the new product name.

#### Acceptance Criteria

1. THE Background Script SHALL declare the primary API class as `SeerrAPI`, replacing the former `JellyseerrAPI` declaration.
2. THE Background Script SHALL instantiate `SeerrAPI` as the active class, replacing any instantiation of `JellyseerrAPI`.
3. THE Background Script SHALL contain no remaining references to the identifier `JellyseerrAPI`.

### Requirement 4: File Rename and Class Rename — SeerrClient

**User Story:** As a developer, I want the shared client file and its exported class to be named `SeerrClient`, so that the source code and file system reflect the new product name.

#### Acceptance Criteria

1. THE Extension SHALL provide the shared client at the path `src/shared/SeerrClient.js`, replacing `src/shared/JellyseerrClient.js`.
2. THE file `src/shared/SeerrClient.js` SHALL declare and export the class `SeerrClient`, replacing the former `JellyseerrClient` class declaration.
3. THE `BaseIntegration.js` file SHALL instantiate `SeerrClient` in place of `JellyseerrClient`.
4. THE Extension SHALL contain no remaining source files or references to the filename `JellyseerrClient.js` or the class name `JellyseerrClient`.

### Requirement 5: Manifest Updates

**User Story:** As a user and a store reviewer, I want the extension name, description, and action title to reflect the Seerr brand, and all internal file path references to use the renamed client file.

#### Acceptance Criteria

1. THE Manifest `name` field SHALL be `"Seerr Request Button"`, replacing `"Jellyseerr Request Button"`.
2. THE Manifest `description` field SHALL reference `"Seerr"` instead of `"Jellyseerr"`.
3. THE Manifest `action.default_title` field SHALL be `"Seerr Request Button"`, replacing `"Jellyseerr Request Button"`.
4. WHEN a Content Script Entry previously listed `"src/shared/JellyseerrClient.js"`, THE Manifest SHALL list `"src/shared/SeerrClient.js"` in its place.
5. THE Manifest SHALL update all 7 Content Script Entries that reference the shared client file to use `"src/shared/SeerrClient.js"`.

### Requirement 13: Fix SeerrClient Init Guards in All 7 Site Integrations

**User Story:** As a developer, I want all site content scripts to initialise correctly after the class rename, so that the flyout panel appears on every supported site.

#### Acceptance Criteria

1. THE `imdb-integration.js` content script SHALL check `typeof SeerrClient !== 'undefined'` in its initialisation guard, replacing the former check for `typeof JellyseerrClient !== 'undefined'`.
2. THE `rt-integration.js` content script SHALL check `typeof SeerrClient !== 'undefined'` in its initialisation guard, replacing the former check for `typeof JellyseerrClient !== 'undefined'`.
3. THE `letterboxd-integration.js` content script SHALL check `typeof SeerrClient !== 'undefined'` in its initialisation guard, replacing the former check for `typeof JellyseerrClient !== 'undefined'`.
4. THE `metacritic-integration.js` content script SHALL check `typeof SeerrClient !== 'undefined'` in its initialisation guard, replacing the former check for `typeof JellyseerrClient !== 'undefined'`.
5. THE `tmdb-integration.js` content script SHALL check `typeof SeerrClient !== 'undefined'` in its initialisation guard, replacing the former check for `typeof JellyseerrClient !== 'undefined'`.
6. THE `trakt-integration.js` content script SHALL check `typeof SeerrClient !== 'undefined'` in its initialisation guard, replacing the former check for `typeof JellyseerrClient !== 'undefined'`.
7. THE `filmweb-integration.js` content script SHALL check `typeof SeerrClient !== 'undefined'` in its initialisation guard, replacing the former check for `typeof JellyseerrClient !== 'undefined'`.
8. THE Extension SHALL contain no remaining initialisation guards in any site content script that reference `typeof JellyseerrClient`.

### Requirement 6: UI String Updates — Button Text

**User Story:** As a user, I want the request button on media pages to read "Request on Seerr", so that the button reflects the current product name.

#### Acceptance Criteria

1. THE `BaseIntegration.js` file SHALL use the string `"Request on Seerr"` wherever `"Request on Jellyseerr"` previously appeared as button creation text.
2. THE Background Script SHALL use the string `"Request on Seerr"` wherever `"Request on Jellyseerr"` previously appeared in `buttonText` fields of returned status objects.
3. THE `SeerrClient.js` file SHALL use the string `"Cannot connect to Seerr server"` in error messages that previously referenced `"Jellyseerr server"`.
4. THE `BaseIntegration.js` file SHALL use the string `"Cannot connect to Seerr server"` in error messages that previously referenced `"Jellyseerr server"`.

### Requirement 7: UI String Updates — HTML Files

**User Story:** As a user, I want the options page and popup to display Seerr branding in all titles, labels, help text, and placeholder text.

#### Acceptance Criteria

1. THE options page (`options.html`) `<title>` SHALL be `"Seerr Request Button - Settings"`.
2. THE options page heading (`<h1>`) SHALL read `"Seerr Request Button"`.
3. THE options page subtitle SHALL reference `"Seerr server connection"` replacing `"Jellyseerr server connection"`.
4. THE options page form label for the server URL input SHALL read `"Seerr Server URL"`.
5. THE options page `placeholder` attribute for the server URL input SHALL be `"https://seerr.example.com"`.
6. THE options page `<small>` help text for the API key SHALL reference `"Seerr Settings"` instead of `"Jellyseerr Settings"`.
7. THE options page footer link text SHALL reference `seerr-browser-extension` instead of `jellyseerr-browser-extension`.
8. THE popup (`popup.html`) `<title>` SHALL be `"Seerr Request Button"`.
9. THE popup header `<h1>` SHALL read `"Seerr"`.
10. THE popup configured-state description text SHALL reference `"Seerr"` instead of `"Jellyseerr"`.
11. THE popup error-state message SHALL reference `"Seerr server"` instead of `"Jellyseerr server"`.

### Requirement 8: Debug Namespace Rename

**User Story:** As a developer, I want the browser console debug object to be accessible at `window.seerr_debug`, so that debugging tools and documentation reflect the new product name.

#### Acceptance Criteria

1. THE `BaseIntegration.js` file SHALL create and populate `window.seerr_debug` in the `setupDebugFunctions` method, replacing `window.jellyseerr_debug`.
2. THE `BaseIntegration.js` file SHALL NOT create or reference `window.jellyseerr_debug`.
3. WHEN `window.seerr_debug` is already initialised, THE `BaseIntegration.js` file SHALL add site-specific debug functions to the existing object without resetting it.

### Requirement 9: Comment and Log Message Updates

**User Story:** As a developer, I want code comments, log prefixes, and console messages to reference Seerr, so that the codebase is internally consistent.

#### Acceptance Criteria

1. THE Background Script file header comment SHALL reference `"Seerr"` instead of `"Jellyseerr"`.
2. THE `SeerrClient.js` file header comment SHALL reference `"Seerr API Client"` instead of `"Jellyseerr API Client"`.
3. THE Background Script console log messages that display the string `"Jellyseerr"` in their text SHALL use `"Seerr"` instead, except for messages that log raw API responses or external data beyond the developer's control.
4. THE Background Script error messages shown to users (e.g., those thrown as `new Error(...)`) SHALL reference `"Seerr"` instead of `"Jellyseerr"`.

### Requirement 10: Preserved Jellyfin Branding

**User Story:** As a user, I want all "Watch on Jellyfin" buttons and Jellyfin-related text to remain unchanged, so that Jellyfin functionality is not broken by the Seerr rebranding.

#### Acceptance Criteria

1. THE Extension SHALL preserve every occurrence of the string `"Watch on Jellyfin"` without modification.
2. THE Extension SHALL preserve every occurrence of the string `"Jellyfin"` that relates to watch URLs, the Jellyfin media server, or Jellyfin configuration, without modification.
3. THE Extension SHALL preserve all `/api/v1/` API endpoint paths without modification.

### Requirement 34: CSS Class, ID, and DOM Selector Rename

**User Story:** As a developer, I want all CSS class names, element IDs, and DOM query selectors to use the `seerr-` prefix instead of `jellyseerr-`, so that the internal styling layer is consistent with the new product branding.

#### Acceptance Criteria

1. THE `UIComponents.js` `getSharedCSS()` method SHALL use the `seerr-` prefix for all CSS class names, replacing any `jellyseerr-` prefixed class names (~60 occurrences).
2. THE `UIComponents.js` file SHALL use `seerr-` prefix for all DOM element IDs (e.g., `seerr-flyout-*`, `seerr-styles-*`, `seerr-in-library-badge`, `seerr-watchlist-button`), replacing any `jellyseerr-` prefixed IDs.
3. THE `UIComponents.js` `createFlyout()` method SHALL use the ID format `seerr-flyout-${this.siteName.toLowerCase()}`.
4. THE `UIComponents.js` `injectStyles()` method SHALL use the style ID `seerr-styles-${this.siteName.toLowerCase()}`.
5. THE 7 site integration files (`imdb-integration.js`, `rt-integration.js`, `tmdb-integration.js`, `letterboxd-integration.js`, `metacritic-integration.js`, `trakt-integration.js`, `filmweb-integration.js`) SHALL use the `seerr-` prefix in all site-specific CSS override blocks.
6. THE `BaseIntegration.js` file SHALL use the `seerr-` prefix in all DOM query selectors (e.g., `.seerr-media-info`, `.seerr-title`), replacing any `jellyseerr-` prefixed selectors.
7. THE Extension SHALL contain no remaining CSS class names, element IDs, or DOM selectors using the `jellyseerr-` prefix.

### Requirement 14: Fix `MediaExtractor.createMediaData()` to pass through `tmdbId`

**User Story:** As a developer, I want `MediaExtractor.createMediaData()` to include the `tmdbId` field in the standardised media data object, so that integrations that extract a TMDB ID from the page (TMDb, Letterboxd, Trakt) can pass it downstream to the watchlist, ratings overlay, and other features that require it.

#### Acceptance Criteria

1. THE `MediaExtractor.createMediaData()` method SHALL include `tmdbId: rawData.tmdbId || null` in the returned object, alongside the existing fields (`imdbId`, `title`, `year`, `mediaType`, `posterUrl`, `overview`, `source`).
2. WHEN `rawData.tmdbId` is not provided or is falsy, THE method SHALL set `tmdbId` to `null` without throwing.
3. THE `tmdb-integration.js`, `letterboxd-integration.js`, and `trakt-integration.js` content scripts already pass `tmdbId` in `rawData`; after this fix their extracted TMDB IDs SHALL be present in the media data object used by all downstream consumers.

---

## Phase 2: New Features

### Requirement 11: Add to Watchlist Button

**User Story:** As a user, I want to add media to my Seerr watchlist directly from the flyout panel, so that I can save content I am interested in without immediately requesting it.

#### Acceptance Criteria

1. WHEN the flyout panel is displayed and `statusData.status` is `'available'` or `statusData.buttonClass` is `'request'` (i.e. the media has not yet been requested), THE UIComponents SHALL render a secondary "Add to Watchlist" button below the primary action button in the flyout panel.
2. WHEN the media status is `'pending'`, `'downloading'`, or `'available_watch'`, THE UIComponents SHALL NOT render the "Add to Watchlist" button.
3. WHEN the user clicks the "Add to Watchlist" button, THE BaseIntegration SHALL send a message to the Background Script with action `'addToWatchlist'` and the current media's `mediaType` and `tmdbId`.
4. WHEN the Background Script receives a message with action `'addToWatchlist'`, THE Background Script SHALL send a POST request to `/api/v1/watchlist` with body `{ mediaType, mediaId }` using the configured `seerrUrl` and `seerrApiKey`.
5. WHEN the POST request to `/api/v1/watchlist` succeeds, THE Extension SHALL display a success notification with the message `"Added to Watchlist"`.
6. IF the POST request to `/api/v1/watchlist` fails, THEN THE Extension SHALL display an error notification describing the failure.
7. THE SeerrClient SHALL provide a method `addToWatchlist(mediaData)` that sends the `'addToWatchlist'` action message to the Background Script and returns the result.

### Requirement 12: In-Library Green Check Badge

**User Story:** As a user, I want to see a green "In Library" badge next to the media title in the flyout when the content is already available on Jellyfin, so that I can tell at a glance that the content is in the library without reading the button text.

#### Acceptance Criteria

1. WHEN `statusData.status` is `'available_watch'` (status code 5), THE UIComponents SHALL render a small green checkmark badge with the text `"In Library"` inside the flyout's `jellyseerr-media-info` section, positioned adjacent to the media title.
2. WHEN `statusData.status` is NOT `'available_watch'`, THE UIComponents SHALL NOT display the "In Library" badge.
3. THE BaseIntegration SHALL call the UIComponents method to show the "In Library" badge when `statusData.status === 'available_watch'` and to hide it for all other status values.
4. THE UIComponents SHALL create and manage the "In Library" badge element, providing methods to show and hide it without recreating the flyout panel.

---

## Phase 3: Project-Level Updates

### Requirement 32: Project Metadata Updates

**User Story:** As a developer and user, I want all project-level files (README, CHANGELOG, Makefile) to reference "Seerr" instead of "Jellyseerr", so that the project identity is consistent across all surfaces and the build system uses the correct name.

#### Acceptance Criteria

1. THE README.md SHALL use "Seerr Request Button" as the title, replacing "Jellyseerr Request Button".
2. THE README.md SHALL reference "Seerr" in all descriptions, installation instructions, setup guides, and usage documentation.
3. THE README.md architecture diagram SHALL reference `SeerrClient.js` instead of `JellyseerrClient.js`.
4. THE README.md installation instructions SHALL reference `seerr-browser-extension` instead of `jellyseerr-browser-extension`.
5. THE CHANGELOG.md SHALL use "Seerr Request Button" in its header and SHALL reference Seerr branding throughout.
6. THE Makefile `NAME` variable SHALL be `seerr-browser-extension`, replacing `jellyseerr-browser-extension`.

### Requirement 33: Test Infrastructure Setup

**User Story:** As a developer, I want a test framework in place so that I can run property-based tests and smoke tests to validate the migration correctness before releasing.

#### Acceptance Criteria

1. THE project SHALL include a `package.json` with a test script.
2. THE test runner SHALL support running property-based tests (e.g. fast-check) and unit-level smoke tests.
3. THE test infrastructure SHALL provide a mock for `chrome.storage.sync` suitable for property-based testing of the storage migration.
4. THE test infrastructure SHALL support DOM-level testing for UI component rendering (optionally via jsdom).
5. ALL test sources SHALL reside under a `tests/` directory at the project root.

---

## Phase 4: Epic — Seerr Pre-Request Ratings Overlay

### Introduction

This epic adds a ratings overlay to Seerr pages so users can evaluate a title at the point of request using Rotten Tomatoes context, without leaving Seerr. The implementation injects into Seerr's own UI — browse/discover cards and movie/TV detail pages — rather than into third-party review sites. It prefers ratings data already exposed by Seerr, falling back to confidence-aware resolution only when needed. The request flow remains visually primary throughout.

### Glossary (Overlay)

- **Injection Surface**: A DOM location on a Seerr page where the overlay injects UI (card badge, detail-page ratings row, pre-request summary).
- **Ratings Bundle**: The shared data model carrying RT critics score, RT audience score, IMDb rating, TMDB rating, confidence score, source label, and last-updated timestamp.
- **Confidence Score**: A 0–1 value indicating trust in the Rotten Tomatoes match. Scores below threshold are suppressed.
- **Pre-Request Summary**: A one-line quality heuristic shown near the request action (e.g. "Critics love it", "Mixed reviews").
- **Session Cache**: An in-memory store keyed by TMDB ID that prevents redundant lookups within a single browser session.
- **SPA Navigation**: Client-side route changes within Seerr's React app that do not trigger a full page reload.
- **RatingsModel**: `src/shared/RatingsModel.js` — the shared typed ratings bundle used by all overlay consumers.
- **RatingsConfig**: `src/shared/RatingsConfig.js` — the centralised thresholds and comparison rules for quality summary heuristics.
- **SeerrIntegration**: `src/content/seerr-integration.js` — the new content script that runs on Seerr pages.

---

### Requirement 15: Map Seerr Injection Surfaces

**User Story:** As a developer, I want a documented map of which Seerr routes and DOM anchors support overlay injection, so that the implementation targets stable selectors and fails silently on unsupported pages.

#### Acceptance Criteria

1. THE implementation SHALL document supported Seerr routes: discover/browse (`/`), search (`/search`), movie detail (`/movie/:id`), and TV detail (`/tv/:id`).
2. THE implementation SHALL document at least one resilient CSS selector per supported page type for card-level injection and detail-header injection.
3. WHEN a Seerr page does not match a supported route or the expected DOM anchor is absent, THE overlay SHALL fail silently — no errors thrown, no broken UI rendered.

---

### Requirement 16: Detect SPA Route Changes on Seerr

**User Story:** As a user, I want the ratings overlay to appear correctly after navigating between Seerr pages without a full page reload, so that the experience is consistent regardless of how I browse.

#### Acceptance Criteria

1. THE `SeerrIntegration` content script SHALL detect client-side route changes on Seerr using the same `pushState`/`replaceState` override and `popstate` listener pattern established in `BaseIntegration.setupNavigationDetection()`.
2. WHEN a route change is detected, THE overlay SHALL re-run injection for the new page.
3. THE injection logic SHALL be idempotent — injecting into a page that already has overlay elements SHALL not duplicate badges, rows, or summaries.
4. WHEN a route change leads away from a supported page, THE overlay SHALL clean up previously injected elements.

---

### Requirement 17: Prefer Seerr-Native Ratings Data

**User Story:** As a developer, I want the overlay to use ratings data already present in the Seerr page before making any external requests, so that the implementation is lightweight and does not duplicate data Seerr already has.

#### Acceptance Criteria

1. THE `SeerrIntegration` SHALL inspect Seerr page state, embedded JSON, or fetch responses for existing Rotten Tomatoes, IMDb, and TMDB rating values before attempting any external resolution.
2. WHEN a Seerr-native RT score is found, THE overlay SHALL use it directly without any external lookup.
3. THE implementation SHALL extract and record the TMDB ID and IMDb ID available on each supported Seerr route, as these are the primary identifiers for any fallback resolution.

---

### Requirement 18: Shared Ratings Model

**User Story:** As a developer, I want a single typed ratings bundle used by all overlay components, so that partial data does not break rendering and all consumers have a consistent interface.

#### Acceptance Criteria

1. THE `RatingsModel` module SHALL define a bundle with fields: `rtCriticsScore` (number|null), `rtAudienceScore` (number|null), `imdbRating` (number|null), `tmdbRating` (number|null), `confidence` (number 0–1), `source` (string), `lastUpdated` (timestamp|null).
2. WHEN any field is absent or unknown, THE model SHALL set it to `null` — partial bundles SHALL be valid and renderable.
3. ALL overlay UI components (card badge, detail row, pre-request summary) SHALL consume the `RatingsModel` type exclusively.

---

### Requirement 19: Session Cache and Request Coalescing

**User Story:** As a user, I want ratings lookups to be fast and non-redundant so that browsing Seerr does not result in repeated network requests for the same title.

#### Acceptance Criteria

1. THE ratings resolution layer SHALL maintain an in-memory session cache keyed by TMDB ID.
2. WHEN a cached entry exists and is not stale, THE overlay SHALL render from cache without issuing a new lookup.
3. WHEN multiple callers request ratings for the same TMDB ID simultaneously, THE implementation SHALL coalesce them into a single in-flight request — subsequent callers receive the same promise.
4. WHEN a cached entry is stale, THE overlay SHALL refresh it asynchronously in the background without blocking the current render.

---

### Requirement 20: Confidence-Aware Resolution

**User Story:** As a user, I want to see ratings only when the match is trustworthy, so that I am not misled by a wrong Rotten Tomatoes result attached to the wrong title.

#### Acceptance Criteria

1. WHEN a Seerr-native RT score is present, THE overlay SHALL use it with full confidence and skip external resolution.
2. WHEN external resolution is needed, THE implementation SHALL prefer stable ID-based mapping (TMDB ID → RT slug) over title/year string-matching.
3. THE implementation SHALL compute a confidence score for each match. Matches scoring below the configured threshold SHALL be suppressed — no score is shown rather than a wrong score.
4. WHEN a match confidence is below threshold but above zero, THE overlay on detail pages MAY show an uncertain-match indicator (e.g. a `~` prefix) rather than fully suppressing the score, so the user knows data exists but is uncertain.

---

### Requirement 21: Detail-Page Ratings Row

**User Story:** As a user browsing a Seerr movie or TV detail page, I want to see a compact ratings row near the title and request action, so that I can evaluate the title without opening another tab.

#### Acceptance Criteria

1. THE overlay SHALL inject a ratings row on Seerr movie detail pages (`/movie/:id`) and TV detail pages (`/tv/:id`).
2. THE ratings row SHALL display scores in this priority order: RT critics score first, RT audience score second, IMDb rating third, TMDB rating fourth.
3. WHEN a score is absent, its section SHALL collapse cleanly — no empty shells, broken separators, or placeholder dashes.
4. THE ratings row SHALL not break the Seerr page layout or obscure any native Seerr UI element.

---

### Requirement 22: Browse-Card Rating Badge

**User Story:** As a user browsing Seerr discover or search results, I want to see a compact RT score badge on each card, so that I can quickly compare titles without opening each detail page.

#### Acceptance Criteria

1. THE overlay SHALL inject a compact RT score badge onto Seerr discover and search result cards.
2. THE badge SHALL be positioned so it does not block card clicks or native Seerr status elements (e.g. the request status dot).
3. WHEN no confident RT score is available for a card, THE badge SHALL be omitted entirely — the card SHALL appear as it does natively.
4. THE badge presentation SHALL remain compact and legible in dense card grids.

---

### Requirement 23: Pre-Request Quality Summary

**User Story:** As a user about to submit a request on a Seerr detail page, I want to see a one-line quality signal near the request button, so that I can make a more informed decision at the moment I act.

#### Acceptance Criteria

1. THE overlay SHALL render a one-line quality summary near the Seerr request action when sufficient ratings data exists.
2. THE summary SHALL use plain-language heuristics derived from `RatingsConfig` thresholds. Examples include: `Critics love it`, `Strong reviews`, `Mixed reviews`, `Audience likes it more than critics`.
3. THE summary SHALL be advisory only — it SHALL NOT block, obscure, or visually compete with the request button.
4. WHEN insufficient data exists to produce a reliable summary, THE summary SHALL be omitted entirely.

---

### Requirement 24: Centralised Summary Thresholds

**User Story:** As a developer, I want all score thresholds and summary rules in a single module, so that they are easy to tune and test without touching display logic.

#### Acceptance Criteria

1. THE `RatingsConfig` module SHALL define all numeric thresholds (e.g. "critics love it" threshold, confidence minimum) and comparison rules (e.g. audience vs critics delta) used to generate quality summaries.
2. THE `RatingsConfig` module SHALL treat a score of `0%` as a valid value — zero SHALL not be treated as absent.
3. Unit tests SHALL cover all threshold boundaries, missing score cases, 0% score cases, and audience-vs-critics edge cases.

---

### Requirement 25: Fallback and Uncertain States

**User Story:** As a user, I want the overlay to degrade gracefully when RT data is unavailable, so that I never see broken or empty UI elements.

#### Acceptance Criteria

1. WHEN RT data is unavailable, THE overlay SHALL fall back to displaying IMDb or TMDB ratings if available, without showing an empty RT shell.
2. THE overlay SHALL never render an empty rating container — if no score can be shown, the container SHALL not be injected.
3. Uncertain-match indicators SHALL be reserved for detail pages only; browse-card badges SHALL remain clean and unambiguous.
4. IF the host extension already uses tooltips elsewhere, THE overlay MAY add optional tooltips explaining rating semantics (e.g. "Tomatometer — % of critics who gave a positive review").

---

### Requirement 26: Seerr-Matched Styling

**User Story:** As a user, I want the ratings overlay to look like it belongs in Seerr, so that the injected elements feel native rather than bolted-on.

#### Acceptance Criteria

1. THE overlay CSS SHALL match Seerr's visual density and typography.
2. THE overlay SHALL support both Seerr's dark and light theme modes without visual breakage.
3. THE request action SHALL remain the visually dominant element on detail pages — overlay elements SHALL be subordinate.
4. THE overlay SHALL avoid excessive animation. Any CSS transitions SHALL be gated behind a `prefers-reduced-motion` media query.

---

### Requirement 27: Debug Mode for Overlay

**User Story:** As a developer, I want an optional debug mode that exposes routing decisions, resolved IDs, rating sources, confidence scores, and cache state, so that I can diagnose rendering failures quickly.

#### Acceptance Criteria

1. THE `SeerrIntegration` SHALL expose a debug mode that is disabled by default and produces no console output in release builds.
2. WHEN debug mode is enabled (without code edits — e.g. via a `window.seerr_debug.ratings.enable()` call), THE overlay SHALL log: route detection result, resolved TMDB/IMDb IDs, rating source decision, confidence score, cache hit/miss, and any selector failures.

---

### Requirement 28: Regression Coverage for Overlay

**User Story:** As a developer, I want automated tests for the overlay's core logic, so that SPA navigation regressions and edge-case rendering bugs are caught before release.

#### Acceptance Criteria

1. Tests SHALL cover route detection, duplicate injection prevention, confidence score handling, summary threshold logic, and session cache coalescing.
2. DOM-level tests SHALL cover card badge rendering, detail-page ratings row rendering, partial-data rendering (some scores missing), and zero-score rendering.
3. A SPA navigation regression test SHALL assert that navigating forward and back within Seerr does not duplicate any injected overlay element.

---

### Requirement 29: Rotten Tomatoes Sorting and Filtering

**User Story:** As a user browsing Seerr discover or search results, I want to sort and filter the result set by Rotten Tomatoes scores, so that I can surface the highest-rated titles without manually checking each one.

#### Acceptance Criteria

1. THE overlay SHALL add RT-based sort controls (at minimum: critic score ascending/descending; optionally audience score) to supported Seerr browse and search surfaces when sufficient ratings coverage exists for the current result set.
2. THE overlay SHALL add filter threshold controls (at minimum: minimum critics score, minimum audience score) that narrow the visible result set in place without requiring a page reload.
3. ALL sort and filter controls SHALL be clearly labelled as extension-provided enhancements, visually distinct from native Seerr controls.
4. WHEN a title in the result set has no RT score, THE overlay SHALL place it last in sorted output by default and SHALL NOT break result rendering.
5. WHEN ratings coverage is insufficient to produce meaningful sorted output, THE sort/filter controls SHALL be hidden or disabled rather than showing misleading results.

---

### Requirement 30: Bulk List Actions

**User Story:** As a user, I want to select multiple titles on a Seerr browse, search, or list page and submit them as a single reviewed batch request, so that I can request several titles efficiently without opening each detail page.

#### Acceptance Criteria

1. THE overlay SHALL add multi-select affordances to supported Seerr browse, search, or list surfaces so users can select multiple titles for a bulk action.
2. WHEN a user initiates a bulk request, THE overlay SHALL present a confirmation screen listing all selected titles before any request is submitted — no auto-submission.
3. THE confirmation screen SHALL surface skipped, duplicate, and unavailable titles clearly, distinguishing them from titles that will be successfully requested.
4. THE overlay SHALL apply the existing confidence rules to RT-driven bulk selections — titles with low-confidence RT matches SHALL be excluded from bulk submission unless the user explicitly reviews and approves them.
5. THE bulk action SHALL require explicit confirmation (e.g. a labelled confirm button) before executing; accidental mass requests SHALL not be possible.

---

### Requirement 31: Release and Rollout

**User Story:** As a developer, I want the overlay features to be releasable safely and documented clearly, so that users and contributors can understand what is supported and how to verify or troubleshoot the enhancement.

#### Acceptance Criteria

1. IF the host project uses staged feature flags, THE card badge, detail-row injection, and pre-request summary features SHALL each be individually gateable so they can be enabled or disabled without a code change.
2. THE project documentation SHALL be updated with: supported Seerr routes, known limitations of the RT resolution approach, and a troubleshooting guide covering the most common failure modes (e.g. ratings not appearing, wrong score, layout breakage).

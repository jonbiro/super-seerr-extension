# Implementation Plan: Seerr Extension Migration

## Overview

Migrate the browser extension from "Jellyseerr" branding to "Seerr" branding through a series of targeted file edits. The migration covers: creating the renamed client file, updating the background script (class rename + storage migration), updating all storage key references across JS files, updating manifest metadata and content script paths, fixing init guards in all 7 site integrations, fixing MediaExtractor tmdbId passthrough, updating all HTML branding strings, renaming the debug namespace, updating project-level files (README, CHANGELOG, Makefile), setting up test infrastructure, and deleting the old client file. No API endpoints or Jellyfin references are changed.

## Tasks

- [ ] 0. Pre-flight — Ensure required asset files exist
  - [ ] 0.1 Create placeholder extension icons in `icons/`
    - Generate `icons/icon16.png`, `icons/icon32.png`, `icons/icon48.png`, `icons/icon128.png` (minimum valid PNGs using extension brand purple `#8b5cf6`)
    - These are required by `manifest.base.json` and the `Makefile` build process
  - [ ] 0.2 Create `LICENSE` file
    - MIT License; referenced by `README.md`

- [ ] 1. Create `src/shared/SeerrClient.js` from `JellyseerrClient.js`
  - [ ] 1.1 Create `src/shared/SeerrClient.js` with all class and export renames applied
    - Copy `JellyseerrClient.js` to `SeerrClient.js`
    - Rename `class JellyseerrClient` → `class SeerrClient`
    - Update `window.JellyseerrClient = JellyseerrClient` → `window.SeerrClient = SeerrClient`
    - Update `module.exports = JellyseerrClient` → `module.exports = SeerrClient`
    - Update file header comment to `// Shared Seerr API Client`
    - Update the error string in `getMediaStatus` to `'Cannot connect to Seerr server. Please check your server URL and API key in extension settings.'`
    - _Requirements: 4.1, 4.2, 6.3, 9.2_

  - [ ]* 1.2 Write property test for `SeerrClient` error message branding
    - **Property 4 (partial): Status response button text references new brand**
    - Verify the connection-failure error message in `SeerrClient` contains `"Seerr"` and does not contain `"Jellyseerr"`
    - **Validates: Requirements 6.3**

- [ ] 2. Update `src/shared/BaseIntegration.js`
  - [ ] 2.1 Update `BaseIntegration.js` client instantiation, button text, error messages, and debug namespace
    - Change `new JellyseerrClient(...)` → `new SeerrClient(...)` in the constructor
    - Change button creation text from `'Request on Jellyseerr'` → `'Request on Seerr'` in `setupButtonUI()`
    - Change error message in `getErrorStatus()` from `'Cannot connect to Jellyseerr server'` → `'Cannot connect to Seerr server'`
    - Change success notification body in `handleRequestButtonClick()` from `'...Jellyseerr requests'` → `'...Seerr requests'`
    - Change `setupDebugFunctions()` to initialise `window.seerr_debug` instead of `window.jellyseerr_debug`, guarding with `if (!window.seerr_debug)`
    - Update the `this.log(...)` line at the end of `setupDebugFunctions()` to reference `window.seerr_debug`
    - Leave the `'Watch on Jellyfin'` check in `handleRequest()` unchanged
    - _Requirements: 4.3, 6.1, 6.4, 8.1, 8.2, 8.3_

  - [ ]* 2.2 Write property test for button text branding (Property 3)
    - **Property 3: Button text never references old brand**
    - Generate varied `mediaData` objects; call the button creation path; assert the button text contains `"Request on Seerr"` and does NOT contain `"Request on Jellyseerr"`
    - **Validates: Requirements 6.1**

  - [ ]* 2.3 Write property test for debug namespace (Properties 6 & 7)
    - **Property 6: Debug namespace does not pollute old key**
    - **Property 7: Debug namespace accumulates without reset**
    - Generate site name strings and pre-existing `window.seerr_debug` objects; call `setupDebugFunctions()`; assert `window.seerr_debug[siteName]` is set, `window.jellyseerr_debug` is never created, and prior entries remain intact
    - **Validates: Requirements 8.1, 8.2, 8.3**

- [ ] 3. Update `src/background/background.js`
  - [ ] 3.1 Add `migrateStorage()` method and update `init()` sequence in `background.js`
    - Add the `migrateStorage()` method as specified in the design: reads `jellyseerrUrl`/`jellyseerrApiKey`, writes to `seerrUrl`/`seerrApiKey`, removes old keys; logs success or catches and logs errors without throwing
    - Update `init()` to call `await this.migrateStorage()` as the first step, before `loadSettings()` and before registering the `chrome.storage.onChanged` listener
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ]* 3.2 Write property tests for storage migration (Properties 1 & 2)
    - **Property 1: Storage migration is a round trip**
    - **Property 2: Migration is idempotent**
    - Mock `chrome.storage.sync` with an in-memory object; generate `{ url: string, apiKey: string }` pairs (including empty strings); assert round-trip correctness (values end up in new keys, old keys absent) and idempotence (no-op when only new keys present)
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**

  - [ ] 3.3 Rename class `JellyseerrAPI` → `SeerrAPI` and update all storage key references in `background.js`
    - Rename `class JellyseerrAPI` → `class SeerrAPI`
    - Update instantiation `new JellyseerrAPI()` → `new SeerrAPI()`
    - Update `loadSettings()` to use `['seerrUrl', 'seerrApiKey']` and `this.baseUrl = settings.seerrUrl` / `this.apiKey = settings.seerrApiKey`
    - Update the `chrome.storage.onChanged` listener to check `changes.seerrUrl || changes.seerrApiKey`
    - Update all error strings thrown via `new Error(...)` that reference `"Jellyseerr server URL and API key"` to reference `"Seerr server URL and API key"`
    - Update file header comment to `// Background service worker for Seerr integration`
    - Update all `console.log` messages that display the literal string `"Jellyseerr"` to use `"Seerr"` instead (excluding any that log raw external API responses)
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 9.1, 9.3, 9.4_

  - [ ] 3.4 Update `buttonText` fields in `formatMediaStatus()` in `background.js`
    - Replace every `'Request on Jellyseerr'` string in `buttonText` fields within `formatMediaStatus()` with `'Request on Seerr'`
    - Leave all `'Watch on Jellyfin'` strings untouched
    - _Requirements: 6.2, 10.1, 10.2_

  - [ ]* 3.5 Write property test for status response button text branding (Property 4 & 5)
    - **Property 4: Status response button text references new brand**
    - **Property 5: "Watch on Jellyfin" is preserved**
    - Generate `mediaDetails` objects with status codes 1, 2, 3, and absent → assert `buttonText` contains `"Seerr"` and not `"Jellyseerr"`
    - Generate `mediaDetails` with `status === 5` and random non-empty `mediaUrl` strings → assert `buttonText === "Watch on Jellyfin"`
    - **Validates: Requirements 6.2, 10.1, 10.2**

- [ ] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4a. Rename all `jellyseerr-` CSS class/id/selector prefixes to `seerr-`
  - [ ] 4a.1 Rename CSS classes, IDs, and text in `src/shared/UIComponents.js`
    - Rename all ~60 `.jellyseerr-*` CSS class names in `getSharedCSS()` to `.seerr-*`
    - Rename DOM element IDs: `jellyseerr-flyout-*` → `seerr-flyout-*`, `jellyseerr-styles-*` → `seerr-styles-*`
    - Rename visible text strings: `'Jellyseerr'` → `'Seerr'`, `'Connecting to Jellyseerr...'` → `'Connecting to Seerr...'`
    - Rename `.jellyseerr-watchlist-button` references to `.seerr-watchlist-button`
    - _Requirements: 34.1, 34.2, 34.3, 34.4_

  - [ ] 4a.2 Rename CSS classes in `src/content/imdb-integration.js` site-specific CSS block
    - Replace all `.jellyseerr-*` class names in `getSiteSpecificCSS()` with `.seerr-*`
    - _Requirements: 34.5_

  - [ ] 4a.3 Rename CSS classes in `src/content/rt-integration.js` site-specific CSS block
    - Replace all `.jellyseerr-*` class names in `getSiteSpecificCSS()` with `.seerr-*`
    - _Requirements: 34.5_

  - [ ] 4a.4 Rename CSS classes in `src/content/tmdb-integration.js` site-specific CSS block
    - Replace all `.jellyseerr-*` class names in `getSiteSpecificCSS()` with `.seerr-*`
    - _Requirements: 34.5_

  - [ ] 4a.5 Rename CSS classes in `src/content/letterboxd-integration.js` site-specific CSS block
    - Replace all `.jellyseerr-*` class names in `getSiteSpecificCSS()` with `.seerr-*`
    - _Requirements: 34.5_

  - [ ] 4a.6 Rename CSS classes in `src/content/metacritic-integration.js` site-specific CSS block
    - Replace all `.jellyseerr-*` class names in `getSiteSpecificCSS()` with `.seerr-*`
    - _Requirements: 34.5_

  - [ ] 4a.7 Rename CSS classes in `src/content/trakt-integration.js` site-specific CSS block
    - Replace all `.jellyseerr-*` class names in `getSiteSpecificCSS()` with `.seerr-*`
    - _Requirements: 34.5_

  - [ ] 4a.8 Rename CSS classes in `src/content/filmweb-integration.js` site-specific CSS block
    - Replace all `.jellyseerr-*` class names in `getSiteSpecificCSS()` with `.seerr-*`
    - _Requirements: 34.5_

  - [ ] 4a.9 Rename DOM query selectors in `src/shared/BaseIntegration.js`
    - Replace `.jellyseerr-media-info` → `.seerr-media-info` in `updateStatus()` badge logic
    - Replace `.jellyseerr-title` → `.seerr-title` in `showInLibraryBadge()` lookups
    - Replace `.jellyseerr-watchlist-button` → `.seerr-watchlist-button` in click handler setup
    - _Requirements: 34.6, 34.7_

- [ ] 5. Fix SeerrClient init guards in all 7 site integrations
  - [ ] 5.1 Fix init guard in `src/content/imdb-integration.js`
    - Replace `typeof JellyseerrClient !== 'undefined'` with `typeof SeerrClient !== 'undefined'`
    - _Requirements: 13.1, 13.8_

  - [ ] 5.2 Fix init guard in `src/content/rt-integration.js`
    - Replace `typeof JellyseerrClient !== 'undefined'` with `typeof SeerrClient !== 'undefined'`
    - _Requirements: 13.2, 13.8_

  - [ ] 5.3 Fix init guard in `src/content/letterboxd-integration.js`
    - Replace `typeof JellyseerrClient !== 'undefined'` with `typeof SeerrClient !== 'undefined'`
    - _Requirements: 13.3, 13.8_

  - [ ] 5.4 Fix init guard in `src/content/metacritic-integration.js`
    - Replace `typeof JellyseerrClient !== 'undefined'` with `typeof SeerrClient !== 'undefined'`
    - _Requirements: 13.4, 13.8_

  - [ ] 5.5 Fix init guard in `src/content/tmdb-integration.js`
    - Replace `typeof JellyseerrClient !== 'undefined'` with `typeof SeerrClient !== 'undefined'`
    - _Requirements: 13.5, 13.8_

  - [ ] 5.6 Fix init guard in `src/content/trakt-integration.js`
    - Replace `typeof JellyseerrClient !== 'undefined'` with `typeof SeerrClient !== 'undefined'`
    - _Requirements: 13.6, 13.8_

  - [ ] 5.7 Fix init guard in `src/content/filmweb-integration.js`
    - Replace `typeof JellyseerrClient !== 'undefined'` with `typeof SeerrClient !== 'undefined'`
    - _Requirements: 13.7, 13.8_

- [ ] 6. Fix `MediaExtractor.createMediaData()` tmdbId passthrough
  - [ ] 6.1 Add `tmdbId: rawData.tmdbId || null` to the returned object in `createMediaData()`
    - _Requirements: 14.1, 14.2, 14.3_

  - [ ]* 6.2 Write property test for tmdbId round-trip (Property 11)
    - **Property 11: tmdbId round-trips through createMediaData**
    - Generate arbitrary `rawData` objects with and without `tmdbId`; assert `result.tmdbId === rawData.tmdbId` when present, `null` when absent
    - **Validates: Requirement 14**

- [ ] 7. Update `src/options/options.js` and `src/popup/popup.js` storage keys
  - [ ] 7.1 Update storage key names in `options.js`
    - Change `chrome.storage.sync.get(['jellyseerrUrl', 'jellyseerrApiKey'])` → `get(['seerrUrl', 'seerrApiKey'])` in `loadSettings()`
    - Change `chrome.storage.sync.set({ jellyseerrUrl: ..., jellyseerrApiKey: ... })` → `set({ seerrUrl: ..., seerrApiKey: ... })` in `saveSettings()` and `testConnection()`
    - Update the status message in `testConnection()` from `'Testing connection to Jellyseerr server...'` → `'Testing connection to Seerr server...'`
    - _Requirements: 2.3_

  - [ ] 7.2 Update storage key names in `popup.js`
    - Change `chrome.storage.sync.get(['jellyseerrUrl', 'jellyseerrApiKey'])` → `get(['seerrUrl', 'seerrApiKey'])` in `checkStatus()`
    - Update display reference `settings.jellyseerrUrl` → `settings.seerrUrl`
    - Update the null-check `!settings.jellyseerrUrl || !settings.jellyseerrApiKey` → `!settings.seerrUrl || !settings.seerrApiKey`
    - _Requirements: 2.4_

- [ ] 8. Update manifest files
  - [ ] 8.1 Update `manifest.base.json` branding fields and all 7 content script paths
    - Change `"name"` from `"Jellyseerr Request Button"` → `"Seerr Request Button"`
    - Change `"description"` to reference `"Seerr"` instead of `"Jellyseerr"`
    - Change `"action.default_title"` from `"Jellyseerr Request Button"` → `"Seerr Request Button"`
    - Replace all 7 occurrences of `"src/shared/JellyseerrClient.js"` → `"src/shared/SeerrClient.js"` in `content_scripts[].js` arrays
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ] 8.2 Update `manifest.firefox.json` extension ID
    - Change `"browser_specific_settings.gecko.id"` from `"jellyseerr-request-button@example.com"` → `"seerr-request-button@example.com"`
    - _Requirements: 5.1 (Firefox-specific)_

- [ ] 9. Update HTML branding strings
  - [ ] 9.1 Update all Jellyseerr branding strings in `src/options/options.html`
    - Change `<title>` to `"Seerr Request Button - Settings"`
    - Change `<h1>` to `"Seerr Request Button"`
    - Change `<p class="subtitle">` to `"Configure your Seerr server connection"`
    - Change `<label for="serverUrl">` to `"Seerr Server URL"`
    - Change `placeholder` on the server URL input to `"https://seerr.example.com"`
    - Change the `<small>` API key help text from `"from Jellyseerr Settings"` → `"from Seerr Settings"`
    - Change the footer `<a>` `href` from `jellyseerr-browser-extension` → `seerr-browser-extension` and update link text accordingly
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ] 9.2 Update all Jellyseerr branding strings in `src/popup/popup.html`
    - Change `<title>` to `"Seerr Request Button"`
    - Change the header `<h1>` from `"Jellyseerr"` → `"Seerr"`
    - Change the `configuredState` `<p>` text from `"The Jellyseerr request button"` → `"The Seerr request button"`
    - Change the `notConfiguredState` `<p>` text from `"Configure your Jellyseerr server URL"` → `"Configure your Seerr server URL"`
    - Change the `errorState` default `<p>` text from `"Unable to connect to your Jellyseerr server."` → `"Unable to connect to your Seerr server."`
    - _Requirements: 7.8, 7.9, 7.10, 7.11_

- [ ] 10. Update project-level files
  - [ ] 10.1 Update `README.md` with Seerr branding
    - Replace title from `Jellyseerr Request Button` → `Seerr Request Button`
    - Replace all user-visible `"Jellyseerr"` references with `"Seerr"`
    - Update architecture diagram: `JellyseerrClient.js` → `SeerrClient.js`
    - Update installation instructions: `jellyseerr-browser-extension` → `seerr-browser-extension`
    - _Requirements: 32.1, 32.2, 32.3, 32.4_

  - [ ] 10.2 Update `CHANGELOG.md` with Seerr branding
    - Replace `Jellyseerr Request Button` → `Seerr Request Button` in header
    - Update `JellyseerrClient` → `SeerrClient` in architecture section
    - _Requirements: 32.5_

  - [ ] 10.3 Update `Makefile` NAME variable
    - Change `NAME = jellyseerr-browser-extension` → `NAME = seerr-browser-extension`
    - _Requirements: 32.6_

- [ ] 11. Set up test infrastructure
  - [ ] 11.1 Create `package.json` with test script and fast-check dependency
    - _Requirements: 33.1, 33.2_

  - [ ] 11.2 Create `tests/helpers/chrome-mock.js` with in-memory `chrome.storage.sync` mock
    - _Requirements: 33.3_

  - [ ] 11.3 Create test stub files under `tests/` for smoke tests
    - _Requirements: 33.4, 33.5_

- [ ] 12. Delete `src/shared/JellyseerrClient.js` and verify no stale references
  - [ ] 12.1 Delete `src/shared/JellyseerrClient.js`
    - Remove the file from the repository
    - _Requirements: 4.1, 4.4_

  - [ ]* 12.2 Write smoke/grep tests to verify no stale Jellyseerr identifiers remain
    - Assert no source file contains `JellyseerrClient`, `JellyseerrAPI`, `jellyseerrUrl`, `jellyseerrApiKey`, `window.jellyseerr_debug`, or the user-visible string `"Jellyseerr"` (excluding occurrences of `"Jellyfin"`)
    - Assert `src/shared/SeerrClient.js` exists
    - Assert `src/shared/JellyseerrClient.js` does NOT exist
    - Parse and assert `manifest.base.json` fields: `name`, `description`, `action.default_title`, and all 7 content script paths point to `SeerrClient.js`
    - Parse `options.html` and `popup.html` and assert the specific text values per Requirements 7.1–7.11
    - Assert README.md, CHANGELOG.md, and Makefile contain no stale Jellyseerr-branded text (excluding `"Jellyfin"`)
    - _Requirements: 3.3, 4.4, 5.1–5.5, 7.1–7.11, 10.1, 10.2, 32.1–32.6_

- [ ] 13. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Add "Add to Watchlist" button
  - [ ] 14.1 Add `addToWatchlist(data)` method to `SeerrAPI` in `background.js`
    - Implement `async addToWatchlist(data)` — throws if `this.baseUrl` or `this.apiKey` is missing
    - Sends a POST request to `/api/v1/watchlist` with body `{ mediaType: data.mediaType, mediaId: data.tmdbId }`
    - _Requirements: 11.4_

  - [ ] 14.2 Add `'addToWatchlist'` case to `handleMessage()` switch in `background.js`
    - Call `await this.addToWatchlist(request.data)` and respond with `{ success: true, data: result }`
    - _Requirements: 11.4_

  - [ ] 14.3 Add `addToWatchlist(mediaData)` method to `SeerrClient.js`
    - Wrap `chrome.runtime.sendMessage` with action `'addToWatchlist'` and data `{ mediaType, tmdbId }`
    - Resolve or reject based on `response.success` / `chrome.runtime.lastError`
    - _Requirements: 11.7_

  - [ ] 14.4 Update `UIComponents.createFlyoutContent()` and `updateFlyoutStatus()`
    - Create a hidden `.seerr-watchlist-button` element (`style: 'display:none'`) and store it in `elements.watchlistButton`
    - In `updateFlyoutStatus()`, show the button when `statusData.status === 'available'` or `statusData.buttonClass === 'request'`; hide it for all other statuses
    - _Requirements: 11.1, 11.2_

  - [ ] 14.5 Add watchlist button CSS to `UIComponents.getSharedCSS()`
    - Add `.seerr-watchlist-button` styles — outlined purple button (`border: 2px solid #8b5cf6`, `color: #8b5cf6`, transparent background, hover state with `rgba(139, 92, 246, 0.1)`)
    - _Requirements: 11.1_

  - [ ] 14.6 Add `handleWatchlistClick()` method to `BaseIntegration.js`
    - Call `await this.client.addToWatchlist(this.mediaData)`
    - On success: call `this.ui.createNotification('Added to Watchlist', '...added to your Seerr watchlist', 'success')`
    - On error: call `this.ui.createNotification('Watchlist Failed', err.message, 'error')`
    - _Requirements: 11.3, 11.5, 11.6_

  - [ ] 14.7 Wire watchlist button click handler in `BaseIntegration.setupFlyoutUI()`
    - After the flyout elements are created, attach `() => this.handleWatchlistClick()` as a click listener to `elements.watchlistButton`
    - _Requirements: 11.3_

  - [ ]* 14.8 Write property test for watchlist button visibility (Property 8)
    - **Property 8: Watchlist button visibility is determined solely by requestability**
    - Generate arbitrary `statusData` objects; call `updateFlyoutStatus()`; assert button is visible iff `status === 'available'` OR `buttonClass === 'request'`, hidden for all other values
    - **Validates: Requirements 11.1, 11.2**

  - [ ]* 14.9 Write property test for watchlist POST body construction (Property 9)
    - **Property 9: Watchlist POST body is constructed correctly from any media data**
    - Generate media data objects with arbitrary `mediaType` and `tmdbId`; assert `addToWatchlist()` issues POST to `/api/v1/watchlist` with body `{ mediaType, mediaId: data.tmdbId }`
    - **Validates: Requirements 11.4, 11.7**

- [ ] 15. Add "In Library" green check badge
  - [ ] 15.1 Add `showInLibraryBadge(mediaInfoElement)` method to `UIComponents.js`
    - Create badge element with stable ID `seerr-in-library-badge` and class `seerr-in-library-badge`
    - Guard with `if (document.getElementById('seerr-in-library-badge')) return` for idempotence
    - Append to `.seerr-title` inside `mediaInfoElement` (or directly to `mediaInfoElement` if title not found)
    - _Requirements: 12.1, 12.4_

  - [ ] 15.2 Add `hideInLibraryBadge(mediaInfoElement)` method to `UIComponents.js`
    - Remove the element with ID `seerr-in-library-badge` if it exists; no-op otherwise
    - _Requirements: 12.2, 12.4_

  - [ ] 15.3 Add `.seerr-in-library-badge` CSS rule to `UIComponents.getSharedCSS()`
    - Green pill badge: `background: #10b981`, `color: white`, `font-size: 11px`, `font-weight: 600`, `padding: 2px 8px`, `border-radius: 9999px`, `margin-left: 8px`, `vertical-align: middle`
    - _Requirements: 12.1_

  - [ ] 15.4 Update `BaseIntegration.updateStatus()` to show/hide the badge
    - After receiving status data and when `this.uiTheme === 'flyout'` and `this.uiElements.panel` exists, query `.seerr-media-info`
    - Call `this.ui.showInLibraryBadge(mediaInfoEl)` when `statusData.status === 'available_watch'`
    - Call `this.ui.hideInLibraryBadge(mediaInfoEl)` for all other status values
    - _Requirements: 12.3_

  - [ ]* 15.5 Write property test for In-Library badge idempotence and visibility (Property 10)
    - **Property 10: In-Library badge is shown iff status is available_watch, and is never duplicated**
    - Generate arbitrary sequences of `updateStatus()` calls with mixed status values; assert exactly one badge in DOM when most-recent status is `'available_watch'`, zero otherwise; assert repeated `showInLibraryBadge()` calls never produce more than one badge
    - **Validates: Requirements 12.1, 12.2, 12.4**

---

## Epic: Seerr Pre-Request Ratings Overlay

Show Rotten Tomatoes context on Seerr browse cards and detail pages so users can evaluate a title at the point of request without leaving Seerr. Prefers Seerr-native ratings data first; falls back to confidence-aware resolution only when needed. The request flow remains visually primary throughout.

**Prerequisites:** Core migration (tasks 1–13) must be complete before starting this epic.

**Definition of done:**
- Ratings appear on supported Seerr browse and detail pages
- The enhancement survives client-side navigation without duplicating injected UI
- Low-confidence Rotten Tomatoes matches are suppressed or clearly marked
- Missing ratings degrade gracefully with no broken shells
- The request button remains the dominant action

- [ ] 16. Map Seerr injection surfaces
  - [ ] 16.1 Identify supported Seerr routes (discover, search, movie detail, TV detail, request modal/inline area) and document stable DOM anchors for card injection and detail-header injection using resilient selectors
  - [ ] 16.2 Record unsupported or ambiguous surfaces that should fail silently
  - _Requirements: 15.1, 15.2, 15.3_

- [ ] 17. Detect SPA route changes on Seerr
  - [ ] 17.1 Integrate route-change detection so the ratings feature re-runs on Seerr client-side navigation (reuse/extend the existing `setupNavigationDetection()` pattern from `BaseIntegration`)
  - [ ] 17.2 Ensure route handling is idempotent — add cleanup guards or data markers for previously enhanced nodes so repeated navigation does not duplicate badges or headers
  - _Requirements: 16.1, 16.2, 16.3, 16.4_

- [ ] 18. Create shared ratings modules
  - [ ] 18.1 Create `src/shared/RatingsModel.js` — a typed ratings bundle with fields for RT critics score, RT audience score, IMDb rating, TMDB rating, confidence score (0–1), source label, and last-updated timestamp
  - [ ] 18.2 Ensure the model supports partial data so UI components can render with whatever subset is available; missing fields must not break rendering
  - _Requirements: 18.1, 18.2, 18.3_

  - [ ] 18.3 Create `src/shared/RatingsConfig.js` — centralised thresholds, confidence minimum, summary heuristic rules
  - _Requirements: 24.1, 24.2_

- [ ] 19. Create `src/content/seerr-integration.js` content script
  - [ ] 19.1 Implement route detection (`/`, `/search`, `/movie/:id`, `/tv/:id`) and Seerr-instance verification guard
  - [ ] 19.2 Implement SPA navigation detection using `pushState`/`replaceState` override pattern (reuse from `BaseIntegration`)
  - [ ] 19.3 Implement idempotent injection guard using `data-seerr-overlay` attribute
  - [ ] 19.4 Expose debug mode on `window.seerr_debug.ratings` (disabled by default)
  - _Requirements: 15.1, 16.1, 16.3, 27.1, 27.2_

- [ ] 20. Prefer Seerr-native ratings data and add session cache
  - [ ] 20.1 Implement extraction of Seerr page's embedded RT, IMDb, TMDB values — use directly, confidence = 1.0
  - [ ] 20.2 Implement in-memory session cache keyed by TMDB ID, with TTL from `RatingsConfig`
  - [ ] 20.3 Implement request coalescing for concurrent lookups of the same TMDB ID
  - [ ] 20.4 Implement stale cache background refresh
  - _Requirements: 17.1, 17.2, 19.1, 19.2, 19.3, 19.4_

- [ ] 21. Build confidence-aware resolution
  - [ ] 21.1 Use Seerr-provided RT values when present and skip external resolution entirely
  - [ ] 21.2 When enrichment is needed, prefer stable ID mapping (TMDB ID → RT slug) before title/year string-matching fallback
  - [ ] 21.3 Score match confidence and suppress RT results below the confidence threshold — do not render a score that cannot be trusted
  - _Requirements: 20.1, 20.2, 20.3, 20.4_

- [ ] 22. Inject detail-page ratings row
  - [ ] 22.1 Render a compact ratings row near the Seerr title and request action on movie and TV detail pages, showing RT critics score first, then audience score, then IMDb and TMDB
  - [ ] 22.2 Handle missing values without leaving broken separators or empty container elements — each score section collapses cleanly when absent
  - _Requirements: 21.1, 21.2, 21.3, 21.4_

- [ ] 23. Inject browse-card rating badge
  - [ ] 23.1 Add compact RT score badges to Seerr discover and search cards, overlaid in a corner that does not block card clicks or native Seerr status elements (request status dot, etc.)
  - [ ] 23.2 Keep badge presentation compact enough for dense card grids; omit badges on cards where no confident score is available
  - _Requirements: 22.1, 22.2, 22.3, 22.4_

- [ ] 24. Add pre-request quality summary
  - [ ] 24.1 Show a one-line quality summary near the request action when enough data exists, using simple heuristics: `Critics love it`, `Strong reviews`, `Mixed reviews`, `Audience likes it more than critics`, etc.
  - [ ] 24.2 Ensure the summary is advisory only — it must not block, obscure, or visually compete with the request button
  - _Requirements: 23.1, 23.2, 23.3, 23.4_

- [ ] 25. Implement fallback and uncertain states
  - [ ] 25.1 Fall back to IMDb or TMDB score display when RT is unavailable — never render an empty rating shell
  - [ ] 25.2 Reserve uncertain-match indicators (e.g. a `~` prefix or tooltip) for detail pages only; keep browse-card badges clean
  - [ ]* 25.3 Add optional tooltips explaining rating semantics if they fit the existing extension tooltip pattern
  - _Requirements: 25.1, 25.2, 25.3, 25.4_

- [ ] 26. Style the enhancement to match Seerr
  - [ ] 26.1 Create `src/content/seerr-overlay.css` — fits Seerr's visual density and both dark and light theme modes; keeps injected elements visually subordinate to the request action
  - [ ] 26.2 Avoid excessive animation; add a `prefers-reduced-motion` media query guard for any transitions
  - _Requirements: 26.1, 26.2, 26.3, 26.4_

- [ ] 27. Add overlay manifest entry to `manifest.base.json`
  - [ ] 27.1 Add a new `content_scripts` entry matching `http://*/movie/*`, `https://*/movie/*`, `http://*/tv/*`, `https://*/tv/*`, `http://*/search*`, `https://*/search*`, and localhost URLs
  - [ ] 27.2 Include `src/shared/RatingsModel.js`, `src/shared/RatingsConfig.js`, `src/shared/UIComponents.js`, `src/content/seerr-integration.js` in the `js` array
  - [ ] 27.3 Include `src/content/seerr-overlay.css` in the `css` array
  - [ ] 27.4 Set `run_at` to `document_idle`
  - _Requirements: Design § Overlay Architecture — Manifest Addition_

- [ ] 28. Add regression coverage for overlay
  - [ ] 28.1 Add tests for route detection, duplicate injection prevention, confidence score handling, summary threshold logic, and cache coalescing behaviour
  - [ ] 28.2 Add DOM-level tests for card badge and detail-page ratings row rendering, including partial-data and zero-score edge cases
  - [ ] 28.3 Add a SPA-navigation regression test asserting that navigating forward and back does not duplicate injected elements
  - _Requirements: 28.1, 28.2, 28.3_

- [ ]* 29. Add property tests for overlay (Properties 12–15)
  - [ ]* 29.1 Write Property 12: Ratings bundle is always renderable (all 16 null/non-null combinations)
  - [ ]* 29.2 Write Property 13: Session cache never issues more than one concurrent request per TMDB ID
  - [ ]* 29.3 Write Property 14: Summary heuristic is total — every (criticsScore, audienceScore) pair produces exactly one label or null
  - [ ]* 29.4 Write Property 15: Overlay injection is idempotent
  - **Validates: Requirements 18.2, 19.3, 23.1, 23.2, 24.2, 16.3**

- [ ] 30. Add Rotten Tomatoes sorting and filtering
  - [ ] 30.1 Extend supported Seerr browse and search surfaces with RT-based sort controls (critic score ascending/descending; optionally audience score) when ratings coverage is sufficient for the current result set
  - [ ] 30.2 Add filter threshold controls — at minimum a minimum critics score filter and a minimum audience score filter — that narrow the visible result set in place without requiring a page reload
  - [ ] 30.3 Label all sort/filter controls clearly as extension-provided enhancements so users understand they are not native Seerr features
  - [ ] 30.4 Define and implement ordering behaviour for titles without ratings — unrated items go last by default; do not break result rendering when part of the set lacks scores
  - [ ] 30.5 Ensure controls degrade gracefully when ratings coverage is insufficient — hide or disable the sort/filter UI rather than showing misleading sorted output
  - _Requirements: 29.1, 29.2, 29.3, 29.4, 29.5_

- [ ] 31. Add bulk list actions
  - [ ] 31.1 Add multi-select affordances to supported Seerr browse, search, or list surfaces so users can select multiple titles for a bulk action
  - [ ] 31.2 Implement a bulk request review flow — show a confirmation screen listing all selected titles before any request is submitted; do not auto-submit
  - [ ] 31.3 Surface skipped, duplicate, and unavailable titles clearly in the confirmation screen before final submission
  - [ ] 31.4 Apply existing confidence rules to bulk RT-driven selections — exclude low-confidence matches from bulk actions unless the user explicitly reviews and approves them
  - [ ] 31.5 Require explicit per-action confirmation (e.g. a confirm button) to prevent accidental mass requests
  - _Requirements: 30.1, 30.2, 30.3, 30.4, 30.5_

- [ ]* 32. Add release and rollout tasks
  - [ ]* 32.1 Gate card badges, detail-row injection, and pre-request summary behind feature flags if staged rollout is desired
  - [ ]* 32.2 Update docs with supported Seerr routes, known limitations, and troubleshooting notes
  - [ ]* 32.3 Add screenshots or short demos for browse-card badge and detail-page ratings row behaviour
  - _Requirements: 31.1, 31.2_

---

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Task 1 creates the new file before anything imports it; task 12 deletes the old file last to avoid a broken intermediate state
- Tasks 5 (init guard fixes) and 6 (tmdbId fix) run before options/popup/manifest/HTML because they are structurally part of the core migration
- The `migrateStorage()` step (3.1) runs before the `onChanged` listener registration per Requirement 1.6
- All `"Watch on Jellyfin"` and `/api/v1/` strings are explicitly left untouched throughout
- Checkpoints ensure incremental validation after logical groupings of changes
- Property tests validate universal correctness properties; smoke tests validate static structure
- Tasks 16–32 form the RT overlay epic and depend on the core migration (tasks 1–15) being complete first
- The overlay manifest entry (task 27) must be added after the overlay CSS file (task 26) is created

## Task Dependency Graph

```json
{
  "waves": [
    { "id": -1, "tasks": ["0.1", "0.2"] },
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "3.3"] },
    { "id": 3, "tasks": ["3.4", "4a.1", "4a.2", "4a.3", "4a.4", "4a.5", "4a.6", "4a.7", "4a.8", "4a.9", "5.1", "5.2", "5.3", "5.4", "5.5", "5.6", "5.7", "6.1", "7.1", "7.2", "8.1", "8.2", "9.1", "9.2", "10.1", "10.2", "10.3", "11.1", "11.2", "11.3"] },
    { "id": 4, "tasks": ["3.5", "6.2", "12.1", "14.1", "14.3", "14.4", "14.5", "15.1", "15.2", "15.3"] },
    { "id": 5, "tasks": ["12.2", "14.2", "14.6", "14.7", "15.4"] },
    { "id": 6, "tasks": ["14.8", "14.9", "15.5"] },
    { "id": 7, "tasks": ["16.1", "16.2"] },
    { "id": 8, "tasks": ["17.1", "17.2", "18.1", "18.2", "18.3"] },
    { "id": 9, "tasks": ["19.1", "19.2", "19.3", "19.4", "20.1", "20.2", "20.3", "20.4"] },
    { "id": 10, "tasks": ["21.1", "21.2", "21.3", "22.1", "22.2", "23.1", "23.2", "24.1", "24.2"] },
    { "id": 11, "tasks": ["25.1", "25.2", "25.3", "26.1", "26.2"] },
    { "id": 12, "tasks": ["27.1", "27.2", "27.3", "27.4"] },
    { "id": 13, "tasks": ["28.1", "28.2", "28.3", "29.1", "29.2", "29.3", "29.4"] },
    { "id": 14, "tasks": ["30.1", "30.2", "30.3", "30.4", "30.5", "31.1", "31.2", "31.3", "31.4", "31.5"] },
    { "id": 15, "tasks": ["32.1", "32.2", "32.3"] }
  ]
}
```

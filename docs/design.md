# Design Document

## Overview

This document describes the architecture and implementation plan for migrating the Seerr browser extension from "Jellyseerr" branding to "Seerr" branding. The migration is purely cosmetic and structural — no API endpoints, Jellyfin references, or functional logic change. The work is divided into six areas: storage key migration, class/file renaming, manifest updates, UI string updates, debug namespace rename, and comment/log cleanup.

The extension uses no build system. All files are plain JavaScript loaded directly by the browser via `content_scripts` entries in the manifest. This means every rename is a direct file/string edit with no transpilation step.

---

## Architecture

The extension has the following layers:

```
┌──────────────────────────────────────────────────────────┐
│  Manifest (base / chrome / firefox)                      │
│  Declares content_scripts, action title, name, desc      │
└────────────────────┬─────────────────────────────────────┘
                     │ loads
        ┌────────────▼─────────────┐
        │  Content Scripts         │
        │  (per-site integrations) │
        └────────────┬─────────────┘
                     │ extends
        ┌────────────▼─────────────┐
        │  src/shared/             │
        │  ├── SeerrClient.js      │  ← renamed from JellyseerrClient.js
        │  ├── BaseIntegration.js  │
        │  ├── MediaExtractor.js   │
        │  └── UIComponents.js     │
        └────────────┬─────────────┘
                     │ chrome.runtime.sendMessage
        ┌────────────▼─────────────┐
        │  src/background/         │
        │  └── background.js       │  ← class SeerrAPI (was JellyseerrAPI)
        └──────────────────────────┘
        
        ┌──────────────────────────┐
        │  src/options/            │
        │  src/popup/              │  ← HTML branding strings updated
        └──────────────────────────┘
```

No file other than `JellyseerrClient.js` is renamed. All other changes are string replacements within existing files.

---

## Components and Interfaces

### 1. Storage Migration — `background.js`

The current `init()` method in `JellyseerrAPI` (→ `SeerrAPI`) calls `loadSettings()` then registers `chrome.storage.onChanged`. The migration step is inserted between those two actions so the listener only ever fires for new keys.

New `init()` sequence:

```javascript
async init() {
  // Step 1: migrate old keys before anything else
  await this.migrateStorage();

  // Step 2: load active config from new keys
  await this.loadSettings();

  // Step 3: register listener AFTER migration (only sees new keys)
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && (changes.seerrUrl || changes.seerrApiKey)) {
      this.loadSettings();
    }
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    this.handleMessage(request, sender, sendResponse);
    return true;
  });
}
```

`migrateStorage()` implementation:

```javascript
async migrateStorage() {
  try {
    const old = await chrome.storage.sync.get(['jellyseerrUrl', 'jellyseerrApiKey']);
    const updates = {};
    const removals = [];

    if (old.jellyseerrUrl) {
      updates.seerrUrl = old.jellyseerrUrl;
      removals.push('jellyseerrUrl');
    }
    if (old.jellyseerrApiKey) {
      updates.seerrApiKey = old.jellyseerrApiKey;
      removals.push('jellyseerrApiKey');
    }

    if (removals.length > 0) {
      await chrome.storage.sync.set(updates);
      await chrome.storage.sync.remove(removals);
      console.log('✅ [Seerr] Storage migration complete');
    }
  } catch (error) {
    console.error('❌ [Seerr] Storage migration failed, continuing:', error);
    // Non-fatal: loadSettings will use whatever new keys already exist
  }
}
```

`loadSettings()` after migration uses only new keys:

```javascript
async loadSettings() {
  try {
    const settings = await chrome.storage.sync.get(['seerrUrl', 'seerrApiKey']);
    this.baseUrl = settings.seerrUrl;
    this.apiKey = settings.seerrApiKey;
  } catch (error) {
    console.error('Error loading Seerr settings:', error);
  }
}
```

### 2. Class Rename — `background.js`

- `class JellyseerrAPI` → `class SeerrAPI`
- `new JellyseerrAPI()` → `new SeerrAPI()`
- File header comment: `// Background service worker for Seerr integration`

All `buttonText` fields that returned `'Request on Jellyseerr'` are updated to `'Request on Seerr'`. The `'Watch on Jellyfin'` string is left unchanged in all `switch` cases.

### 3. File Rename and Class Rename — `SeerrClient.js`

A new file `src/shared/SeerrClient.js` is created. The old file `src/shared/JellyseerrClient.js` is deleted.

Changes inside the file:

- `class JellyseerrClient` → `class SeerrClient`
- `window.JellyseerrClient = JellyseerrClient` → `window.SeerrClient = SeerrClient`
- `module.exports = JellyseerrClient` → `module.exports = SeerrClient`
- File header: `// Shared Seerr API Client`
- Error message: `'Cannot connect to Seerr server. Please check your server URL and API key in extension settings.'`

`BaseIntegration.js` constructor:

```javascript
this.client = new SeerrClient({
  debug: this.debug,
  siteName: this.siteName,
  retryAttempts: options.retryAttempts || 3
});
```

### 4. Manifest Updates

All three manifest files are updated. `manifest.base.json` carries the user-facing metadata. `manifest.firefox.json` carries the Firefox extension ID.

**`manifest.base.json` changes:**

| Field | Old value | New value |
|---|---|---|
| `name` | `"Jellyseerr Request Button"` | `"Seerr Request Button"` |
| `description` | `"Add movies ... to Jellyseerr ..."` | `"Add movies ... to Seerr ..."` |
| `action.default_title` | `"Jellyseerr Request Button"` | `"Seerr Request Button"` |
| Every `content_scripts[].js` entry with `"src/shared/JellyseerrClient.js"` | as above | `"src/shared/SeerrClient.js"` |

There are 7 content script entries, each listing `JellyseerrClient.js` as the first shared script. All 7 are updated to `SeerrClient.js`.

**`manifest.firefox.json` changes:**

| Field | Old value | New value |
|---|---|---|
| `browser_specific_settings.gecko.id` | `"jellyseerr-request-button@example.com"` | `"seerr-request-button@example.com"` |

**`manifest.chrome.json`** — no Jellyseerr-specific strings; no changes needed.

### 5. UI String Updates — `BaseIntegration.js`

Two locations change:

1. `setupButtonUI()` — the `createRequestButton` call:
   ```javascript
   const button = this.ui.createRequestButton({
     text: 'Request on Seerr'
   });
   ```

2. `getErrorStatus()` — the server error message:
   ```javascript
   message: 'Cannot connect to Seerr server'
   ```

3. `handleRequestButtonClick()` — the success notification body:
   ```javascript
   `${this.mediaData.title} has been added to your Seerr requests`
   ```

4. `setupDebugFunctions()` — debug namespace rename (see section 7 below).

The `'Watch on Jellyfin'` check in `handleRequest()` is untouched:
```javascript
const isWatchButton = buttonText === 'Watch on Jellyfin' || currentButton?.classList.contains('watch');
```

### 6. UI String Updates — `options.js` and `popup.js`

**`options.js`** — storage key names only:
- `chrome.storage.sync.get(['jellyseerrUrl', 'jellyseerrApiKey'])` → `get(['seerrUrl', 'seerrApiKey'])`
- `chrome.storage.sync.set({ jellyseerrUrl: ..., jellyseerrApiKey: ... })` → `set({ seerrUrl: ..., seerrApiKey: ... })`
- Status message: `'Testing connection to Seerr server...'`

**`popup.js`** — storage key names only:
- `chrome.storage.sync.get(['jellyseerrUrl', 'jellyseerrApiKey'])` → `get(['seerrUrl', 'seerrApiKey'])`

### 7. UI String Updates — HTML Files

**`options.html`** targeted replacements:

| Element | Old text | New text |
|---|---|---|
| `<title>` | `Jellyseerr Request Button - Settings` | `Seerr Request Button - Settings` |
| `<h1>` | `Jellyseerr Request Button` | `Seerr Request Button` |
| `<p class="subtitle">` | `Configure your Jellyseerr server connection` | `Configure your Seerr server connection` |
| `<label for="serverUrl">` | `Jellyseerr Server URL` | `Seerr Server URL` |
| `placeholder` on server URL | `https://jellyseerr.example.com` | `https://seerr.example.com` |
| `<small>` under API key | `from Jellyseerr Settings` | `from Seerr Settings` |
| Footer `<a>` text / href | `jellyseerr-browser-extension` | `seerr-browser-extension` |

**`popup.html`** targeted replacements:

| Element | Old text | New text |
|---|---|---|
| `<title>` | `Jellyseerr Request Button` | `Seerr Request Button` |
| `<h1>` | `Jellyseerr` | `Seerr` |
| `configuredState` `<p>` | `The Jellyseerr request button` | `The Seerr request button` |
| `notConfiguredState` `<p>` | `Configure your Jellyseerr server URL` | `Configure your Seerr server URL` |
| `errorState` `<p>` (default text) | `Unable to connect to your Jellyseerr server.` | `Unable to connect to your Seerr server.` |

### 8. Debug Namespace Rename — `BaseIntegration.js`

`setupDebugFunctions()` currently initialises `window.jellyseerr_debug`. The new version:

```javascript
setupDebugFunctions() {
  if (!window.seerr_debug) {
    window.seerr_debug = {};
  }

  window.seerr_debug[this.siteName.toLowerCase()] = {
    updateStatus: () => this.updateStatus(),
    testAPI: () => this.client.debugAPI(),
    // ... remaining debug functions unchanged
  };

  this.log('Debug functions added to window.seerr_debug.' + this.siteName.toLowerCase());
}
```

`window.jellyseerr_debug` is never created or referenced anywhere.

### 8.1 CSS Class, ID, and Selector Rename — Requirement 34

All CSS classes, element IDs, and DOM query selectors using the `jellyseerr-` prefix are renamed to `seerr-`. This is a global find-and-replace across 9 files:

**`UIComponents.js`** — Two change categories:

1. **`getSharedCSS()` method** — All ~60 CSS class names in the stylesheet string:
   - `.jellyseerr-request-button` → `.seerr-request-button`
   - `.jellyseerr-button-icon` → `.seerr-button-icon`
   - `.jellyseerr-notification` → `.seerr-notification`
   - `.jellyseerr-flyout` → `.seerr-flyout`
   - `.jellyseerr-tab` → `.seerr-tab`
   - `.jellyseerr-panel` → `.seerr-panel`
   - `.jellyseerr-title` → `.seerr-title`
   - `.jellyseerr-year` → `.seerr-year`
   - `.jellyseerr-status-section` → `.seerr-status-section`
   - `.jellyseerr-media-info` → `.seerr-media-info`
   - `.jellyseerr-status-indicator` → `.seerr-status-indicator`
   - `.jellyseerr-status-icon` → `.seerr-status-icon`
   - `.jellyseerr-status-text` → `.seerr-status-text`
   - `.jellyseerr-action-button` → `.seerr-action-button`
   - `.jellyseerr-connection-status` → `.seerr-connection-status`
   - `.jellyseerr-tab-icon` → `.seerr-tab-icon`
   - `.jellyseerr-tab-text` → `.seerr-tab-text`
   - `.jellyseerr-icon-path` → `.seerr-icon-path`
   - And all sub-classes (`.jellyseerr-notification-close`, `.jellyseerr-notification-title`, `.jellyseerr-notification-message`, etc.)

2. **DOM element IDs and class references in JS**:
   - Flyout ID: `jellyseerr-flyout-${siteName}` → `seerr-flyout-${siteName}`
   - Style ID: `jellyseerr-styles-${siteName}` → `seerr-styles-${siteName}`
   - Badge ID: `seerr-in-library-badge` (already named for Seerr in the design)
   - Watchlist button class: `jellyseerr-watchlist-button` → `seerr-watchlist-button`
   - Visible text strings: `'Jellyseerr'` (tab text) → `'Seerr'`, `'Connecting to Jellyseerr...'` → `'Connecting to Seerr...'`

**7 Site Integration Files** — Each file's site-specific CSS override block uses `.jellyseerr-*` class names inherited from the shared stylesheet. These are renamed following the same pattern. The overrides typically modify properties like `background`, `color`, `border-color` for the `.jellyseerr-tab`, `.jellyseerr-action-button`, `.jellyseerr-request-button` classes. All are updated to `seerr-`.

**`BaseIntegration.js`** — DOM query selectors that reference CSS classes:
  - `.jellyseerr-media-info` → `.seerr-media-info`
  - `.jellyseerr-title` → `.seerr-title`
  - `.jellyseerr-watchlist-button` → `.seerr-watchlist-button`

The rename is a mechanical find-and-replace with no logic changes. No CSS variables or theme colors change; only the prefix.

---

## Data Models

No data model changes. The storage schema changes key names only:

```
Before migration:
  chrome.storage.sync: { jellyseerrUrl: string, jellyseerrApiKey: string }

After migration:
  chrome.storage.sync: { seerrUrl: string, seerrApiKey: string }
```

The `SeerrAPI` instance shape in `background.js` remains:

```javascript
{
  baseUrl: string | null,   // loaded from seerrUrl
  apiKey:  string | null    // loaded from seerrApiKey
}
```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Storage migration throws | Log error, continue — `loadSettings` reads whatever new keys already exist |
| Old keys absent at migration time | No-op, no error |
| Both old and new keys present simultaneously | Old keys overwrite new keys, then old keys deleted (migration always wins) |
| SeerrClient connection failure | Throws `Error('Cannot connect to Seerr server...')` |
| Background script missing config | Throws `Error('Seerr server URL and API key are required...')` |

---

### 9. README, CHANGELOG, and Makefile Updates — Requirement 32

**README.md** — Full pass replacing Jellyseerr with Seerr:
- Title: `# Seerr Request Button`
- All descriptions: replace `"Jellyseerr"` with `"Seerr"`
- Architecture diagram: `JellyseerrClient.js` → `SeerrClient.js`
- Installation instructions: `jellyseerr-browser-extension` → `seerr-browser-extension`
- Setup instructions: replace `"Jellyseerr server"` with `"Seerr server"`
- Usage instructions: replace `"Jellyseerr"` with `"Seerr"` in all user-visible text

**CHANGELOG.md** — Header line change:
- `Jellyseerr Request Button` → `Seerr Request Button`
- Architecture section references: `JellyseerrClient` → `SeerrClient`

**Makefile** — Single variable change:
- `NAME = jellyseerr-browser-extension` → `NAME = seerr-browser-extension`

No functional build logic changes.

### 10. Test Infrastructure — Requirement 33

A minimal test infrastructure is set up at the project root:

**`package.json`:**
```json
{
  "name": "seerr-browser-extension",
  "version": "2.0.0",
  "private": true,
  "scripts": {
    "test": "node --test tests/**/*.test.js",
    "test:watch": "node --watch --test tests/**/*.test.js"
  },
  "devDependencies": {
    "fast-check": "^3.15.0"
  }
}
```

**Test directory structure:**
```
tests/
├── helpers/
│   └── chrome-mock.js      # In-memory chrome.storage.sync mock
├── migration.test.js        # Property tests 1 & 2 (storage migration)
├── branding.test.js         # Property tests 3, 4, 5 (button text / status branding)
├── debug-namespace.test.js  # Property tests 6 & 7 (debug namespace)
├── watchlist.test.js        # Property tests 8 & 9 (watchlist)
├── badge.test.js            # Property test 10 (in-library badge)
├── media-extractor.test.js  # Property test 11 (tmdbId passthrough)
├── ratings-model.test.js    # Property test 12 (partial bundle rendering)
├── ratings-cache.test.js    # Property test 13 (session cache coalescing)
├── ratings-config.test.js   # Property test 14 (summary heuristic)
├── overlay-idempotent.test.js # Property test 15 (injection idempotence)
└── smoke.test.js            # Grep-based smoke checks for stale identifiers
```

**`tests/helpers/chrome-mock.js`:**
```javascript
// Lightweight in-memory mock for chrome.storage.sync
// Used by property tests to verify migration behaviour without a browser
function createStorageMock(initial = {}) {
  const store = { ...initial };
  return {
    get: (keys) => new Promise((resolve) => {
      const result = {};
      (Array.isArray(keys) ? keys : [keys]).forEach(k => {
        if (store[k] !== undefined) result[k] = store[k];
      });
      resolve(result);
    }),
    set: (items) => new Promise((resolve) => {
      Object.assign(store, items);
      resolve();
    }),
    remove: (keys) => new Promise((resolve) => {
      (Array.isArray(keys) ? keys : [keys]).forEach(k => delete store[k]);
      resolve();
    }),
    _dump: () => ({ ...store }),
    _reset: () => { Object.keys(store).forEach(k => delete store[k]); }
  };
}
module.exports = { createStorageMock };
```

Tests use Node's built-in test runner (`node --test`). The fast-check library provides property-based testing. DOM-level tests use jsdom when needed (optional dependency — skipped gracefully if not installed).

## Implementation Order

The recommended execution order minimises the time the extension is in a broken state:

1. Create `src/shared/SeerrClient.js` (new file, do not delete old yet)
2. Update `BaseIntegration.js` to reference `SeerrClient` and new strings
3. Update `background.js` — class rename, storage migration, new keys, new strings
4. Fix SeerrClient init guards in all 7 site integration files
5. Fix `MediaExtractor.createMediaData()` — add tmdbId passthrough
6. Update `options.js` and `popup.js` — new storage keys
7. Update `manifest.base.json` — name, description, title, all 7 content script paths
8. Update `manifest.firefox.json` — extension ID
9. Update `options.html` — all branding strings
10. Update `popup.html` — all branding strings
11. Update `README.md` — all branding strings
12. Update `CHANGELOG.md` — header line
13. Update `Makefile` — NAME variable
14. Set up test infrastructure — `package.json`, `tests/` directory
15. Delete `src/shared/JellyseerrClient.js`
16. Verify no remaining references to old identifiers

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Storage migration is a round trip

*For any* pair of values `(url, apiKey)` stored under the old keys `jellyseerrUrl` / `jellyseerrApiKey`, running `migrateStorage()` followed by `loadSettings()` SHALL result in `this.baseUrl === url` and `this.apiKey === apiKey`, and the old keys SHALL be absent from `chrome.storage.sync`.

**Validates: Requirements 1.1, 1.2, 1.4**

### Property 2: Migration is idempotent

*For any* storage state containing only new keys (`seerrUrl` / `seerrApiKey`) with no old keys present, running `migrateStorage()` SHALL leave storage unchanged — no keys added, removed, or modified.

**Validates: Requirements 1.3**

### Property 3: Button text never references old brand

*For any* media data object passed to the button creation path in `BaseIntegration`, the resulting button element's text content SHALL contain `"Request on Seerr"` and SHALL NOT contain `"Request on Jellyseerr"`.

**Validates: Requirements 6.1**

### Property 4: Status response button text references new brand

*For any* media details object passed to `formatMediaStatus()` in `SeerrAPI` where the media is not available for watching (status codes 1, 2, 3, or absent), the returned `buttonText` field SHALL contain `"Seerr"` and SHALL NOT contain `"Jellyseerr"`.

**Validates: Requirements 6.2**

### Property 5: "Watch on Jellyfin" is preserved

*For any* media details object where `status === 5` (available) and `mediaUrl` is a non-empty string, `formatMediaStatus()` SHALL return `buttonText === "Watch on Jellyfin"` — the Jellyfin string is never replaced.

**Validates: Requirements 10.1, 10.2**

### Property 6: Debug namespace does not pollute old key

*For any* `siteName` string, calling `setupDebugFunctions()` SHALL add an entry to `window.seerr_debug[siteName]` and SHALL NOT create or modify `window.jellyseerr_debug`.

**Validates: Requirements 8.1, 8.2**

### Property 7: Debug namespace accumulates without reset

*For any* pre-existing `window.seerr_debug` object containing entries for sites `S1, S2, ...`, calling `setupDebugFunctions()` for a new site `S_new` SHALL result in all prior entries `S1, S2, ...` remaining intact alongside the new entry.

**Validates: Requirements 8.3**

---

## Testing Strategy

**Dual approach** — smoke/example tests for static code structure, property-based tests for the runtime logic that varies with input.

### Property-Based Tests

Each property above maps to a property test using a framework like fast-check (JS). Run with a minimum of 100 iterations per property.

- **Property 1 & 2** — Generator produces `{ url: string, apiKey: string }` pairs (including empty string cases). Mock `chrome.storage.sync` with a simple in-memory object. Assert round-trip correctness and idempotence.
- **Property 3** — Generator produces varied `mediaData` objects (different titles, types, years). Call the button creation path and assert text content.
- **Property 4** — Generator produces `mediaDetails` objects with status codes 1, 2, 3, and absent. Assert `buttonText` field.
- **Property 5** — Generator produces `mediaDetails` with `status === 5` and random non-empty `mediaUrl` strings. Assert `buttonText === "Watch on Jellyfin"`.
- **Property 6 & 7** — Generator produces site name strings and pre-existing debug namespace objects. Assert namespace state after `setupDebugFunctions()`.

### Smoke / Example-Based Tests

- Grep-based checks: no remaining references to `JellyseerrClient`, `JellyseerrAPI`, `jellyseerrUrl`, `jellyseerrApiKey`, `window.jellyseerr_debug`, `"Jellyseerr"` in user-visible strings (excluding `"Jellyfin"` occurrences).
- JSON parse `manifest.base.json` and assert `name`, `description`, `action.default_title`, and all content script paths.
- Parse `options.html` and `popup.html` and assert specific text values per Requirements 7.1–7.11.
- Assert `src/shared/SeerrClient.js` exists and `src/shared/JellyseerrClient.js` does not exist.

---

## Add to Watchlist Button (Requirement 11)

### Overview

A secondary "Add to Watchlist" button is added to the flyout panel. It appears only when the media has not yet been requested (i.e. it is still requestable), and is hidden for all in-flight or already-available states. The feature touches four layers: `SeerrClient.js`, `background.js`, `UIComponents.js`, and `BaseIntegration.js`.

### SeerrClient — `addToWatchlist(mediaData)`

A new method on `SeerrClient` wraps a `chrome.runtime.sendMessage` call for the `'addToWatchlist'` action:

```javascript
async addToWatchlist(mediaData) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: 'addToWatchlist',
      data: { mediaType: mediaData.mediaType, tmdbId: mediaData.tmdbId }
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && response.success) {
        resolve(response.data);
      } else {
        reject(new Error(response ? response.error : 'No response received'));
      }
    });
  });
}
```

### Background Script — `SeerrAPI`

#### Message handler (`handleMessage` switch)

A new `case` is added to the existing `switch` in `handleMessage()`:

```javascript
case 'addToWatchlist':
  const watchlistResult = await this.addToWatchlist(request.data);
  sendResponse({ success: true, data: watchlistResult });
  break;
```

#### New method `addToWatchlist(data)`

```javascript
async addToWatchlist(data) {
  if (!this.baseUrl || !this.apiKey) {
    throw new Error('Seerr server URL and API key are required');
  }
  const response = await this.makeAPIRequest('POST', '/api/v1/watchlist', {
    mediaType: data.mediaType,
    mediaId: data.tmdbId
  });
  return response;
}
```

### UIComponents — Watchlist Button Rendering

`createFlyoutContent()` gains a secondary watchlist button element stored as `watchlistButton` in the returned `elements` object. The button is always created but conditionally visible:

```javascript
const watchlistButton = this.el('button', {
  className: 'jellyseerr-watchlist-button',
  style: 'display:none'
}, [
  this.svg('M17 12h-5v5h-2v-5H5v-2h5V5h2v5h5v2z', { size: 18 }),
  this.el('span', { textContent: 'Add to Watchlist' })
]);
panel.appendChild(watchlistButton);
elements.watchlistButton = watchlistButton;
```

`updateFlyoutStatus()` evaluates the `statusData` to show or hide the button:

```javascript
// Show watchlist button only when media is requestable
const showWatchlist = statusData.status === 'available' || statusData.buttonClass === 'request';
if (elements.watchlistButton) {
  elements.watchlistButton.style.display = showWatchlist ? 'flex' : 'none';
}
```

CSS for the watchlist button is appended to the shared stylesheet (or the site-specific override):

```css
.jellyseerr-watchlist-button {
  width: 100%;
  padding: 10px 20px;
  background: transparent;
  border: 2px solid #8b5cf6;
  color: #8b5cf6;
  border-radius: 0 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.2s ease;
  outline: none;
}

.jellyseerr-watchlist-button:hover:not(:disabled) {
  background: rgba(139, 92, 246, 0.1);
  transform: translateY(-1px);
}
```

### BaseIntegration — Watchlist Click Handler

`setupFlyoutUI()` stores `elements.watchlistButton` reference (already handled by the spread `...elements` assignment) and adds the click listener:

```javascript
if (elements.watchlistButton) {
  elements.watchlistButton.addEventListener('click', () => this.handleWatchlistClick());
}
```

New method `handleWatchlistClick()`:

```javascript
async handleWatchlistClick() {
  try {
    await this.client.addToWatchlist(this.mediaData);
    this.ui.createNotification(
      'Added to Watchlist',
      `${this.mediaData.title} has been added to your Seerr watchlist`,
      'success'
    );
  } catch (err) {
    this.ui.createNotification(
      'Watchlist Failed',
      err.message || 'Failed to add to watchlist',
      'error'
    );
  }
}
```

---

## In-Library Green Check Badge (Requirement 12)

### Overview

A small green pill badge reading "In Library" is injected adjacent to the media title inside the flyout's `jellyseerr-media-info` section whenever `statusData.status === 'available_watch'`. The badge is managed by two new `UIComponents` methods that use a stable element ID to guarantee idempotence.

### UIComponents — `showInLibraryBadge` / `hideInLibraryBadge`

```javascript
showInLibraryBadge(mediaInfoElement) {
  const badgeId = 'seerr-in-library-badge';
  if (document.getElementById(badgeId)) return; // already present — idempotent

  const checkSvg = this.svg(
    'M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z',
    { size: 12, className: 'seerr-badge-icon' }
  );

  const badge = this.el('span', { id: badgeId, className: 'seerr-in-library-badge' }, [
    checkSvg,
    this.el('span', { textContent: 'In Library' })
  ]);

  const titleEl = mediaInfoElement.querySelector('.jellyseerr-title');
  if (titleEl) {
    titleEl.appendChild(badge);
  } else {
    mediaInfoElement.appendChild(badge);
  }
}

hideInLibraryBadge(mediaInfoElement) {
  const badge = document.getElementById('seerr-in-library-badge');
  if (badge) badge.remove();
}
```

### CSS

```css
.seerr-in-library-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #10b981;
  color: white;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 9999px;
  margin-left: 8px;
  vertical-align: middle;
}
```

This rule is added to the shared CSS returned by `UIComponents.getSharedCSS()`.

### BaseIntegration — `updateStatus()` integration

Inside `updateStatus()`, after the status data is received and before the flyout is updated, the badge visibility is toggled:

```javascript
if (this.uiTheme === 'flyout' && this.uiElements.panel) {
  const mediaInfoEl = this.uiElements.panel.querySelector('.jellyseerr-media-info');
  if (mediaInfoEl) {
    if (statusData.status === 'available_watch') {
      this.ui.showInLibraryBadge(mediaInfoEl);
    } else {
      this.ui.hideInLibraryBadge(mediaInfoEl);
    }
  }
}
```

The same `mediaInfoEl` lookup is used in the error-path branch so the badge is always cleared when falling back to an error state.

---

## Init Guard Fixes (Requirement 13)

### Overview

Each of the 7 site content scripts has an initialisation guard that checks whether the shared client class is defined before calling the site-specific `initialize*` function. After the class rename from `JellyseerrClient` to `SeerrClient`, these guards must reference the new name or the flyout will silently never initialise.

### Pattern

In each file the guard at the bottom follows this structure:

```javascript
// BEFORE (broken after rename):
if (typeof JellyseerrClient !== 'undefined') {
  initializeIMDBIntegration();  // or equivalent per-site function
}

// AFTER (correct):
if (typeof SeerrClient !== 'undefined') {
  initializeIMDBIntegration();
}
```

### Affected Files

| File | Guard function |
|---|---|
| `src/content/imdb-integration.js` | `initializeIMDBIntegration` |
| `src/content/rt-integration.js` | `initializeRottenTomatoesIntegration` |
| `src/content/letterboxd-integration.js` | `initializeLetterboxdIntegration` |
| `src/content/metacritic-integration.js` | `initializeMetacriticIntegration` |
| `src/content/tmdb-integration.js` | `initializeTMDBIntegration` |
| `src/content/trakt-integration.js` | `initializeTraktIntegration` |
| `src/content/filmweb-integration.js` | `initializeFilmwebIntegration` |

All 7 files receive a single-string replacement: `typeof JellyseerrClient` → `typeof SeerrClient`. No other logic changes.

---

## Correctness Properties (Requirements 11, 12, 13)

### Property 8: Watchlist button visibility is determined solely by requestability

*For any* `statusData` object passed to `updateFlyoutStatus()`, the watchlist button SHALL be visible (i.e. `display !== 'none'`) if and only if `statusData.status === 'available'` OR `statusData.buttonClass === 'request'`; for all other status values (`'pending'`, `'downloading'`, `'available_watch'`, and any other value) the watchlist button SHALL be hidden.

**Validates: Requirements 11.1, 11.2**

### Property 9: Watchlist POST body is constructed correctly from any media data

*For any* media data object containing `mediaType` and `tmdbId` fields, the `SeerrAPI.addToWatchlist()` method SHALL issue a POST request to `/api/v1/watchlist` with a body equal to `{ mediaType: data.mediaType, mediaId: data.tmdbId }` — the `tmdbId` input is always mapped to the `mediaId` key in the request body, regardless of the values supplied.

**Validates: Requirements 11.4, 11.7**

### Property 10: In-Library badge is shown iff status is available_watch, and is never duplicated

*For any* sequence of `updateStatus()` calls producing an arbitrary mix of status values, the `jellyseerr-media-info` section SHALL contain exactly one `seerr-in-library-badge` element when the most recent status is `'available_watch'`, and zero badge elements for all other status values. Calling `showInLibraryBadge()` multiple times without an intervening `hideInLibraryBadge()` SHALL result in exactly one badge element in the DOM (idempotent insertion).

**Validates: Requirements 12.1, 12.2, 12.4**

---

## MediaExtractor.createMediaData() — tmdbId Fix (Requirement 14)

`MediaExtractor.createMediaData()` currently ignores `rawData.tmdbId`. Several integrations (TMDb, Letterboxd, Trakt) already extract and pass it, but it is silently dropped. The fix is a one-line addition:

```javascript
createMediaData(rawData, source) {
  const mediaData = {
    imdbId:    rawData.imdbId    || null,
    title:     rawData.title     || null,
    year:      rawData.year      || null,
    mediaType: rawData.mediaType || 'movie',
    posterUrl: rawData.posterUrl || null,
    overview:  rawData.overview  || null,
    tmdbId:    rawData.tmdbId    || null,  // ← added
    source:    source
  };
  this.log('Created standardized media data:', mediaData);
  return mediaData;
}
```

No callers change. All downstream consumers (watchlist, ratings overlay) can now rely on `mediaData.tmdbId` being populated wherever the page exposes it.

---

## Epic: Seerr Pre-Request Ratings Overlay

### Architecture

The overlay is a new content script (`src/content/seerr-integration.js`) that runs exclusively on Seerr pages. It does not extend `BaseIntegration` — it is a standalone module that imports the shared `RatingsModel` and `RatingsConfig` helpers. The background script is not involved in ratings lookups; all resolution happens in the content script's execution context using the Seerr page's own data and, when needed, proxied fetch calls through the background.

```
┌─────────────────────────────────────────────────────────────┐
│  Seerr Page (React SPA)                                     │
│  Routes: /, /search, /movie/:id, /tv/:id                    │
└──────────────────────┬──────────────────────────────────────┘
                       │ content script injected
        ┌──────────────▼──────────────┐
        │  src/content/               │
        │  seerr-integration.js       │  ← new file
        └──────────────┬──────────────┘
                       │ imports
        ┌──────────────▼──────────────┐
        │  src/shared/                │
        │  ├── RatingsModel.js        │  ← new: typed ratings bundle
        │  ├── RatingsConfig.js       │  ← new: thresholds & rules
        │  └── UIComponents.js        │  ← existing, extended
        └─────────────────────────────┘
```

### New Files

| File | Purpose |
|---|---|
| `src/content/seerr-integration.js` | Content script for Seerr pages — route detection, injection, SPA nav |
| `src/shared/RatingsModel.js` | Typed ratings bundle factory and partial-data helpers |
| `src/shared/RatingsConfig.js` | Centralised thresholds, confidence minimum, summary heuristic rules |

### Manifest Addition

A new `content_scripts` entry is added to `manifest.base.json`:

```json
{
  "matches": [
    "http://*/movie/*",
    "https://*/movie/*",
    "http://*/tv/*",
    "https://*/tv/*",
    "http://*/search*",
    "https://*/search*",
    "http://localhost:5055/*",
    "https://localhost:5055/*"
  ],
  "js": [
    "src/shared/RatingsModel.js",
    "src/shared/RatingsConfig.js",
    "src/shared/UIComponents.js",
    "src/content/seerr-integration.js"
  ],
  "css": [
    "src/content/seerr-overlay.css"
  ],
  "run_at": "document_idle"
}
```

The `css` array injects `src/content/seerr-overlay.css` automatically alongside the scripts — no manual `<link>` injection needed. This is the correct WebExtension MV3 approach for content script stylesheets.

The broad URL pattern is intentional — users self-host Seerr on arbitrary domains. The integration checks `document.querySelector('[data-testid="navbar"]')` or the presence of Seerr-specific DOM markers to confirm it is running inside an actual Seerr instance before injecting anything.

---

### RatingsModel — `src/shared/RatingsModel.js`

```javascript
// Shared Ratings Bundle
// All overlay consumers use this model. Partial bundles (some fields null) are valid.

function createRatingsBundle(partial = {}) {
  return {
    rtCriticsScore:  partial.rtCriticsScore  ?? null,  // 0–100 integer or null
    rtAudienceScore: partial.rtAudienceScore ?? null,  // 0–100 integer or null
    imdbRating:      partial.imdbRating      ?? null,  // 0.0–10.0 float or null
    tmdbRating:      partial.tmdbRating      ?? null,  // 0.0–10.0 float or null
    confidence:      partial.confidence      ?? 0,     // 0–1 float
    source:          partial.source          ?? 'unknown',
    lastUpdated:     partial.lastUpdated     ?? null
  };
}

function hasAnyScore(bundle) {
  return bundle.rtCriticsScore !== null ||
         bundle.rtAudienceScore !== null ||
         bundle.imdbRating !== null ||
         bundle.tmdbRating !== null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createRatingsBundle, hasAnyScore };
} else if (typeof window !== 'undefined') {
  window.RatingsModel = { createRatingsBundle, hasAnyScore };
}
```

---

### RatingsConfig — `src/shared/RatingsConfig.js`

```javascript
// Centralised thresholds and summary rules.
// All numeric values are in the same unit as the relevant score (0–100 for RT, 0–10 for IMDb/TMDB).

const RatingsConfig = {
  // Minimum confidence to render an RT score at all
  confidenceThreshold: 0.7,

  // Thresholds for quality summary heuristics (RT critics %)
  summary: {
    criticsCertifiedFresh: 75,   // "Critics love it"
    criticsStrong:         60,   // "Strong reviews"
    criticsMixed:          40,   // "Mixed reviews"
    // Below 40 → "Mostly negative reviews"
  },

  // Audience vs critics delta for the "Audience disagrees" summary
  audienceCriticsDelta: 15,  // e.g. audience 80, critics 60 → "Audience likes it more"

  // Session cache TTL in milliseconds (5 minutes)
  cacheTtlMs: 5 * 60 * 1000,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RatingsConfig;
} else if (typeof window !== 'undefined') {
  window.RatingsConfig = RatingsConfig;
}
```

---

### SeerrIntegration — `src/content/seerr-integration.js`

#### Route Detection

```javascript
function detectRoute() {
  const path = window.location.pathname;
  if (/^\/movie\/\d+/.test(path)) return { type: 'movie-detail', id: path.match(/\/movie\/(\d+)/)[1] };
  if (/^\/tv\/\d+/.test(path))    return { type: 'tv-detail',    id: path.match(/\/tv\/(\d+)/)[1] };
  if (/^\/search/.test(path))     return { type: 'search' };
  if (path === '/')               return { type: 'discover' };
  return null;
}
```

#### SPA Navigation

Reuses the same `pushState`/`replaceState` override pattern from `BaseIntegration`:

```javascript
let currentPath = window.location.pathname;

const originalPushState = history.pushState;
history.pushState = function(...args) {
  originalPushState.apply(history, args);
  setTimeout(handleRouteChange, 150);
};
window.addEventListener('popstate', () => setTimeout(handleRouteChange, 150));

function handleRouteChange() {
  if (window.location.pathname === currentPath) return;
  currentPath = window.location.pathname;
  cleanupOverlay();
  injectOverlay();
}
```

#### Idempotency Guard

Each injected element receives a `data-seerr-overlay="true"` attribute. Before injection, the script checks for existing elements with this attribute and skips re-injection if found.

#### Session Cache

```javascript
const ratingsCache = new Map(); // key: tmdbId (string), value: { bundle, expiresAt }

async function getRatings(tmdbId) {
  const cached = ratingsCache.get(String(tmdbId));
  if (cached && Date.now() < cached.expiresAt) return cached.bundle;

  // Coalesce concurrent requests
  if (ratingsCache.has(`pending:${tmdbId}`)) {
    return ratingsCache.get(`pending:${tmdbId}`);
  }

  const promise = resolveRatings(tmdbId);
  ratingsCache.set(`pending:${tmdbId}`, promise);

  const bundle = await promise;
  ratingsCache.delete(`pending:${tmdbId}`);
  ratingsCache.set(String(tmdbId), {
    bundle,
    expiresAt: Date.now() + RatingsConfig.cacheTtlMs
  });
  return bundle;
}
```

#### Ratings Resolution Strategy

1. Check Seerr page's own DOM/JSON for embedded RT, IMDb, TMDB values → use directly, confidence = 1.0
2. If TMDB ID is known, attempt ID-based RT slug lookup via background fetch proxy → confidence based on ID match quality
3. Fall back to title/year string match → confidence based on normalized string similarity
4. If confidence < `RatingsConfig.confidenceThreshold` → suppress RT, use IMDb/TMDB fallback only

---

### Detail-Page Ratings Row

Injected adjacent to the Seerr title/overview block. Each score segment is a flex child that is rendered only when its value is non-null:

```html
<div class="seerr-ratings-row" data-seerr-overlay="true">
  <!-- Only rendered when rtCriticsScore !== null -->
  <span class="seerr-rating-item seerr-rt-critics">
    🍅 <strong>84%</strong> <small>Tomatometer</small>
  </span>
  <!-- Only rendered when rtAudienceScore !== null -->
  <span class="seerr-rating-item seerr-rt-audience">
    🍿 <strong>91%</strong> <small>Audience</small>
  </span>
  <!-- etc. -->
</div>
```

Uncertain matches on detail pages add a `~` prefix and a title tooltip: `~84% (low confidence match)`.

---

### Browse-Card Badge

Injected as an absolutely-positioned overlay in the card's top-right corner:

```html
<span class="seerr-card-badge" data-seerr-overlay="true">🍅 84%</span>
```

CSS positions it so it does not overlap the native Seerr request-status dot (typically bottom-right):

```css
.seerr-card-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  background: rgba(0, 0, 0, 0.72);
  color: white;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  pointer-events: none;
  z-index: 10;
}
```

The card itself needs `position: relative` — the injector adds this if it is not already set.

---

### Pre-Request Quality Summary

Injected below the ratings row on detail pages, above the request button:

```javascript
function buildSummary(bundle) {
  const { rtCriticsScore: c, rtAudienceScore: a } = bundle;
  if (c === null) return null;

  const cfg = RatingsConfig.summary;
  if (c >= cfg.criticsCertifiedFresh) {
    if (a !== null && a - c >= RatingsConfig.audienceCriticsDelta) {
      return 'Audience loves it even more than critics';
    }
    return 'Critics love it';
  }
  if (c >= cfg.criticsStrong)  return 'Strong reviews';
  if (c >= cfg.criticsMixed)   return 'Mixed reviews';
  if (a !== null && a - c >= RatingsConfig.audienceCriticsDelta) {
    return 'Audience likes it more than critics';
  }
  return 'Mostly negative reviews';
}
```

---

### Styling

All overlay CSS lives in `src/content/seerr-overlay.css` (a new file injected via the manifest `css` array in the Seerr content scripts entry). Key principles:
- Uses Seerr's CSS custom properties (`--color-text-main`, `--color-card-background`) where available, with hard-coded fallbacks for both dark and light modes.
- No `!important` overrides on Seerr's own elements.
- All transitions wrapped in `@media (prefers-reduced-motion: no-preference)`.

---

### Debug Mode

The overlay registers itself on `window.seerr_debug.ratings`:

```javascript
if (!window.seerr_debug) window.seerr_debug = {};
window.seerr_debug.ratings = {
  enable:       () => { debugMode = true; console.log('[Seerr Overlay] Debug enabled'); },
  disable:      () => { debugMode = false; },
  cache:        () => ratingsCache,
  currentRoute: () => detectRoute(),
  clearCache:   () => ratingsCache.clear(),
};
```

When `debugMode` is true, every resolution step logs its inputs and outputs prefixed with `🍅 [Seerr Overlay]`.

---

## Data Models (Overlay Addition)

```
RatingsBundle:
  rtCriticsScore:  number | null   (0–100)
  rtAudienceScore: number | null   (0–100)
  imdbRating:      number | null   (0.0–10.0)
  tmdbRating:      number | null   (0.0–10.0)
  confidence:      number          (0–1)
  source:          string          ('seerr-native' | 'id-lookup' | 'title-match' | 'fallback')
  lastUpdated:     number | null   (Unix timestamp ms)

Session Cache Entry:
  bundle:          RatingsBundle
  expiresAt:       number          (Unix timestamp ms)
```

---

## Error Handling (Overlay)

| Scenario | Behaviour |
|---|---|
| Route is unsupported | `detectRoute()` returns null; injector exits silently |
| DOM anchor not found | Injection skipped for that surface; no error thrown |
| Ratings resolution throws | Catch, log in debug mode, render fallback (IMDb/TMDB) or nothing |
| Confidence below threshold | RT score suppressed; fallback scores shown if available |
| SPA navigation while resolution in-flight | Previous promise abandoned; new resolution starts for new route |
| Duplicate injection attempted | `data-seerr-overlay` guard prevents re-injection; no-op |

---

## Correctness Properties (Requirements 14–28)

### Property 11: tmdbId round-trips through createMediaData

*For any* `rawData` object with a `tmdbId` field, calling `MediaExtractor.createMediaData(rawData, source)` SHALL return an object where `result.tmdbId === rawData.tmdbId`. *For any* `rawData` without `tmdbId`, the result SHALL have `tmdbId === null`.

**Validates: Requirement 14**

### Property 12: Ratings bundle is always renderable regardless of which fields are null

*For any* combination of null and non-null fields in a `RatingsBundle`, the overlay UI rendering functions SHALL NOT throw and SHALL produce valid DOM (or produce no DOM at all, without broken shells). This property holds for all 2^4 = 16 combinations of null/non-null for the four score fields.

**Validates: Requirement 18.2**

### Property 13: Session cache never issues more than one concurrent request per TMDB ID

*For any* set of N concurrent `getRatings(tmdbId)` calls with the same `tmdbId`, exactly one network request SHALL be issued; all N callers SHALL receive the same result.

**Validates: Requirement 19.3**

### Property 14: Summary heuristic is total — every (criticsScore, audienceScore) pair produces exactly one label or null

*For any* non-null `rtCriticsScore` value (including 0), `buildSummary()` SHALL return a non-null string from the defined label set. The function SHALL never return undefined, throw, or produce an unlisted label. *When `rtCriticsScore` is null*, the function SHALL return null.

**Validates: Requirements 23.1, 23.2, 24.2**

### Property 15: Overlay injection is idempotent

*For any* supported Seerr route, calling the injection function N times SHALL result in exactly the same number of overlay elements as calling it once — no duplicates. This holds for both card badges and detail-page ratings rows.

**Validates: Requirement 16.3**

---

## RT Sorting and Filtering (Requirement 29)

### Overview

Once the session cache is populated for a result set, sort and filter controls are injected above the Seerr card grid. All operations are client-side — no additional network requests are made for sorting or filtering.

### Control Injection

Controls are injected inside a `<div class="seerr-sort-filter-bar" data-seerr-overlay="true">` inserted immediately before the first card container. The bar contains:

- A **Sort by** dropdown: options are `Default (Seerr order)`, `RT Critics ↓`, `RT Critics ↑`, and optionally `RT Audience ↓` / `RT Audience ↑`
- A **Min critics score** number input (0–100, step 5)
- A **Min audience score** number input (0–100, step 5, optional)
- A **Reset** button that restores Seerr's original order

Controls are hidden if fewer than 30% of visible cards have a resolved RT score — not enough coverage to make sorting meaningful.

### Sort Implementation

The injector stores the original DOM order of cards by recording each card element's index. On sort:

```javascript
function sortCards(cards, field, direction) {
  return [...cards].sort((a, b) => {
    const scoreA = getRatingFromCard(a, field) ?? -1; // unrated → last
    const scoreB = getRatingFromCard(b, field) ?? -1;
    return direction === 'desc' ? scoreB - scoreA : scoreA - scoreB;
  });
}
```

Sorted cards are re-appended to their container in the new order. The original order is restored when the user selects "Default".

### Filter Implementation

Filter inputs trigger a `filterCards()` pass that sets `display: none` on cards whose score is below threshold. Cards with no score are hidden only if the user explicitly sets a threshold above 0 (i.e. a threshold of 0 means "show everything including unrated").

### Graceful Degradation

If Seerr updates its DOM structure and the card container selector breaks, the sort/filter bar is simply not injected — no error is surfaced to the user.

---

## Bulk List Actions (Requirement 30)

### Overview

Multi-select mode overlays a checkbox on each card. When the user activates it (via a "Select titles" toggle button in the sort/filter bar), each card gains a `seerr-select-checkbox` overlay. Selecting cards accumulates `tmdbId` values. A floating action bar appears at the bottom of the viewport showing the count of selected titles and a "Review & Request" button.

### Activation Flow

```
User clicks "Select titles" toggle
  → checkboxes appear on all cards
  → floating action bar appears (0 selected)

User checks cards
  → count updates in action bar

User clicks "Review & Request"
  → confirmation modal opens

Confirmation modal shows:
  ┌─────────────────────────────────┐
  │  Review your bulk request       │
  │                                 │
  │  ✅ 4 titles ready to request   │
  │     • The Bear (2022)           │
  │     • Severance (2022)          │
  │     • ...                       │
  │                                 │
  │  ⚠️  2 titles excluded          │
  │     • Unknown Show (~62% conf.) │
  │     • Already requested: Film X │
  │                                 │
  │  [Cancel]      [Request 4 titles] │
  └─────────────────────────────────┘

User clicks "Request 4 titles"
  → SeerrClient.requestMedia() called per title sequentially
  → progress shown inline
  → summary notification on completion
```

### Confidence Filtering

Before the confirmation modal opens, each selected `tmdbId` is checked against the session cache. Entries with `confidence < RatingsConfig.confidenceThreshold` are moved to the "excluded" list automatically. The user can expand the excluded list and manually move items back to the request list — they must do this explicitly, one at a time.

### Error Handling

| Scenario | Behaviour |
|---|---|
| Some requests succeed, some fail | Show per-title status in a post-submission summary; do not roll back successful requests |
| Seerr API rate-limit during bulk | Queue with 500ms delay between requests; show progress |
| Card container selector breaks | Checkboxes not injected; "Select titles" toggle not shown |

### CSS Structure

```css
.seerr-select-checkbox {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 2px solid white;
  background: rgba(0,0,0,0.5);
  cursor: pointer;
  z-index: 20;
}

.seerr-select-checkbox.checked {
  background: #8b5cf6;
  border-color: #8b5cf6;
}

.seerr-bulk-action-bar {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: #1f2937;
  border: 1px solid #374151;
  border-radius: 12px;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  gap: 16px;
  z-index: 9999;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}
```

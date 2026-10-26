# Data, storage and permissions

This document describes **Super Seerr's current browser-extension behavior**. It does not replace the privacy policies of Seerr, Plex, Rotten Tomatoes, IMDb or the other websites the user visits.

Firefox's installation/update disclosure declares **authentication information** and **website content** because configured service credentials and page-derived title metadata leave the browser for those services. This is distinct from developer telemetry: Super Seerr has no project analytics endpoint. The declarations follow [Mozilla's data-transmission taxonomy](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/); they do not enable extra requests or establish store approval.

For installation and everyday use, start with the [README](../README.md) and the [user guide](user-guide.md). Source-level implementation boundaries are documented in [Development](development.md) and [Architecture](design.md).

## Summary

- Super Seerr has **no project telemetry or analytics service configured**. A bug report or diagnostic report is not automatically uploaded.
- It connects to the **Seerr server you choose** and, if you enable the features, makes public rating/title lookups and optional **Plex Universal Watchlist** calls.
- The Seerr API key and Plex token are **stored locally on the device**, not synchronized with browser preferences. Treat both as passwords.
- Permissions are deliberately scoped: nine external discovery sites plus **optional access to your configured Seerr origin**, and separate Plex access if requested.
- Cached ratings, per-server indexes, known title corrections and recent confirmed actions are local data. Some settings may sync through your browser profile.

## Network traffic

| Service | Why requests are sent | What to know |
| --- | --- | --- |
| **Your Seerr server** | Read movie/TV status and available data, show ratings/links, submit **explicitly confirmed** media requests, manage Seerr watchlist actions | API-key-based calls use the key you configured; on-Seerr enhancements may use your existing signed-in page session |
| **Rotten Tomatoes** | Look up external titles and verify potential public critic/audience scores | Titles/years are sent as search terms. Uncertain results are hidden rather than given arbitrary confidence |
| **Plex / plex.tv** | Resolve items through Discover, check and add them to Plex Universal Watchlist | Happens when you supply your own Plex token and use the feature; this is **not** Seerr's watchlist |
| **IMDb, TMDB, Metacritic, Trakt, Filmweb, Letterboxd and Rotten Tomatoes pages** | Read the film/TV metadata visible on supported pages to offer a request flyout | Content scripts are limited to the known page patterns listed in the extension manifest |

Seerr may be backed by Plex, Jellyfin or Emby. A playback link, when available, comes from Seerr; Super Seerr does not assume a specific backend.

The Seerr overlay observes a bounded set of **same-origin `/api/v1/` title-list responses** from your own server to match cards that initially lack visible metadata. It is not intended to inspect messages, issue threads or all API traffic. The worker validates and bounds forwarded fields.

No new requests are automatically submitted on ambiguous matching, page navigation or failed status checks. Request POSTs are not silently retried after the result becomes uncertain. Media server permissions and approval still apply.

## Permissions and active origin

The extension's manifest declares content scripts for **IMDb, Rotten Tomatoes, TMDB, Letterboxd, Metacritic, Trakt and Filmweb**. The supported paths are more specific than permission to run on all websites.

Because your Seerr instance can be hosted on any domain or under a path, the extension requests permission for the specific server origin when you save its URL, then dynamically registers the overlay for that origin/path. It does **not** require the broad `<all_urls>` host permission.

If you reject the server permission, Settings can retain other configuration but the Seerr overlay cannot appear. A **Grant access** notice offers a new permission request. Switching server origins can require a new permission grant and a reload of Seerr's tab.

Plex Watchlist requires a **separate optional permission** to reach `plex.tv`. Refusing that permission disables Plex calls; it does not disable your other Seerr options.

Other network activity naturally follows the third-party websites you visit; their accounts, cookies and traffic are controlled by those sites, not by this project.

## Stored settings, credentials and cached data

| Data | Location / behavior |
| --- | --- |
| Seerr URL, single-site legacy configuration | Older single-site configurations can use browser sync storage until a named/multi-site setup is saved |
| Named/multiple Seerr sites, active choice, URLs and per-site API keys | **Device-local storage** once named/multiple sites are used |
| Seerr API key and Plex token | **Device-local storage; not synced**; older synced Seerr keys are migrated locally on upgrade |
| Overlay preferences and filter presets | Browser **sync storage** where supported |
| Per-server ratings, recent observed title lists | Local bounded cache scoped by URL, port and base path, retained separately per site |
| Verified public RT scores | Separate bounded cache, shared only when media type/TMDB ID and title/year identity checks agree |
| Saved title-match corrections | Local entries tied to the original title/type/year and selected server, revalidated before reuse |
| Recent confirmed actions | The latest **50** confirmed requests / Seerr or Plex watchlist additions, including action type, title, media type and time |
| Diagnostic report | Prepared locally and previewed before download; **not automatically uploaded** |

The cache supports up to **ten** saved Seerr sites. Server-specific ratings retain recent values within a roughly **600 KB** per-site budget. Public provider and RT-title caches have separate roughly **1 MB** bounds and preserve their own check times. Complete scored bundles normally refresh after **24 hours**, partial bundles after **one hour**, and absent/failed lookups on shorter schedules. A clear operation invalidates the in-memory data, stored server caches and pending stale writes.

The legacy single-site settings migration is designed to avoid leaving a secret in sync storage after upgrading. Do not assume that a device backup or browser-exported profile is free of credentials; review it before sharing.

### Storage-access differences between browsers

Where supported, the background worker calls `storage.local.setAccessLevel` to limit direct storage access to **trusted extension contexts** before initialization; Chromium browser verification confirms content scripts cannot read the local API key through direct storage calls.

**Not every Firefox version provides the same access-level API.** In environments that lack it, worker-controlled access remains in place, but the Chromium storage-level enforcement must **not** be assumed. The extension's diagnostic report describes the current capability; see [development and browser verification](development.md).

Content scripts request cached ratings through a restricted worker message interface tied to the configured Seerr origin/base path, rather than receiving arbitrary contents of local storage. Changes are coordinated between tabs to prevent old caches or stale writes from overriding newer results.

## Request safety and personal decisions

Uncertain titles require a separate **Choose title** step. A user-selected candidate undergoes an availability check and **another explicit request action** before submission. Choosing to remember a match stores only a reusable local correction and does not itself submit anything.

For **bulk requests**, the UI prompts for review and spaces POSTs apart. Cancel or Escape stops future submissions, but cannot recall a previously sent request. If a submission response is lost, verify the request in Seerr before retrying; Super Seerr does not know whether it succeeded.

**Clearing recent actions is not an undo button.** It erases local history, not already-requested media or watchlist state on Seerr/Plex.

## Logging, diagnostic reports and support

Background logging is quiet by default. **Settings → Troubleshooting → Verbose logging** turns on traces while diagnosing a problem. Raw logs can contain titles, page URLs, server responses and other potentially private metadata; review them carefully, then turn verbose logging off again.

**Settings → Prepare diagnostic report** creates a previewable download containing extension version, check time, storage-isolation capability and separate connection states. It intentionally omits full server addresses, credentials, media titles, saved matches, action history and raw error bodies. Downloading is a user action; Super Seerr does not upload it on its own.

If you open a [public GitHub issue](https://github.com/jonbiro/super-seerr-extension/issues), include only a sanitized page URL, browser/extension version, behavior and an appropriate cropped screenshot. **Never include API keys or Plex tokens.**

## Delete or reset local data

- **Settings → Troubleshooting → Clear ratings cache:** clears ratings and observed title indexes for all saved Seerr sites plus shared public score caches; does not delete the server's library.
- **Settings → Saved matches and support:** inspect and forget remembered title matches; reload a source page after deletion.
- **Popup → Recent actions → Clear history:** deletes local records of confirmed actions; does not cancel requests on Seerr or remove Plex watchlist entries.
- **Remove selected site** in Settings: removes an inactive saved Seerr site and its saved key; action history remains.
- Uninstalling the extension lets the browser remove extension storage according to that browser's behavior. Account-side data and past server actions are separate.

For broader control of data held by Seerr or Plex, use those services directly.

## Scope and limitations

Seerr is the principal integration target. Legacy Overseerr/Jellyseerr installs share many API patterns but have not been comprehensively validated against the latest extension. Matching on live external sites can break when sites change markup or block automated clients, and not all movies have every source score.

The project is **not affiliated with** Seerr, Plex, Rotten Tomatoes or the nine supported movie/TV sites. This is a source-build extension, not a certified privacy product or a publicly approved browser-store release.

## Optional tracker accounts and discovery searches

Settings can connect registered Trakt and Simkl public OAuth apps. The `identity` permission opens the provider sign-in window and supplies the browser callback. Provider API/auth host access is requested when connecting; discovery-page access alone does not connect an account. Access and refresh tokens plus app IDs stay in local extension storage, never browser sync or content-script messages. Disconnect removes this extension’s local tokens and imported in-memory list; revoke the app at the provider to end its grant.

Manual watchlist sync reads planned movies/shows (and identifiable Simkl anime), with at most 500 normalized titles exposed for review. It performs no tracker-list changes or Seerr requests. Imported titles are sent to Seerr only when you choose Find in Seerr. Tokens, titles and imported list contents are not included in diagnostic exports.

Explore-this-title links send the search title only when clicked. JustWatch country selection is a synced preference (`justWatchCountry`); no JustWatch account, private API, account cookies or subscription data are accessed. Copy title writes to the clipboard only after an explicit click. See [tracker setup](tracker-integrations.md) for provider authorization and validation limits.

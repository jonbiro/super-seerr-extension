# Super Seerr architecture

This document describes the implemented system. For installation and controls, see [README](../README.md). For remaining release gates, see [verification workflow](tasks.md).

## Runtime boundaries

| Component | Responsibility |
| --- | --- |
| `BaseIntegration.js` | Common flyout lifecycle, navigation, cleanup, and request interactions |
| `SeerrClient.js` | Content-script messaging, preflight checks, and retries |
| `MediaExtractor.js` | Layered title/year/type/poster/overview/ID extraction |
| `UIComponents.js` | Shared flyout controls, status display, notifications, styling |
| `RatingsModel.js` | Partial bundles; invalid or nonfinite numeric scores become null |
| `RatingsConfig.js` | Confidence, summary thresholds, cache limits, and network deadlines |
| Seven site integrations | Site-specific selectors and themes |
| `seerr-integration.js` | Seerr routes, ratings resolution, card/detail rendering, sorting, filtering, bulk selection |
| `seerr-api-observer.js` | Page-world observer forwarding the title lists Seerr fetches for itself |
| `background.js` | Seerr REST requests, RT search and scorecard parsing, settings migration, toolbar badge |
| Options and popup | Explicit settings save, temporary connection tests, preferences, status |

The seven site integrations are static `content_scripts` entries and load their shared scripts in manifest order. The Seerr overlay is not: a self-hosted server's origin is only known at runtime, so the worker registers it with `chrome.scripting` against the saved origin. The worker is an ES module and imports shared ratings configuration. Browser manifests are shallow-merged with `manifest.base.json` by Make.

## Worker startup and messaging

Message and storage listeners register synchronously. Initialization loads settings, migrates historical connection keys, reloads active settings, then reconciles the overlay registration. Message handling awaits the initialization promise so a waking worker does not process requests with empty configuration. Registration reconciliation must never reject, because that promise gates every message; a browser missing `chrome.scripting` or `chrome.permissions` disables only the overlay.

The content-script client retries only a failed round trip. A reply of `{ success: false }` means the worker ran and Seerr answered, so it is final: `requestMedia` is a non-idempotent POST, and resending it risks a duplicate request.

Messages use an `action` plus action-specific fields. Request/status/watchlist/RT actions use `data`; search and debug helpers also have legacy top-level arguments. Replies are `{ success: true, data }` or `{ success: false, error }`.

The flyout names the media server Seerr is configured against, read from `mediaServerType` on `/api/v1/settings/public`, which needs no API key and so also works in ratings-only mode. Seerr supports Plex, Jellyfin and Emby; when the type is unconfigured or unrecognised the wording stays neutral rather than guessing a product. The watch button is identified by its class, never its label, because that label varies.

Seerr has two status enums and the same number means different things in each: a request carries `MediaRequestStatus` (pending, approved, declined, failed, completed) while media carries `MediaStatus` (unknown, pending, processing, partially available, available, blocklisted, deleted). Status extraction records which kind it found and maps with the matching table. Blocklisted media is reported as such rather than offered for request; deleted media, and media of unknown status, are requestable, which matches Seerr's own cards.

Principal actions are `requestMedia`, `getMediaStatus`, `searchMedia`, `addToWatchlist`, `testConnection`, `getRottenTomatoesRatings`, `getConfigState`, `reloadSettings`, and `ping`. `getConfigState` reports whether requests are available without returning the API key, so the overlay never holds the secret. `testConnection` optionally accepts `data: { seerrUrl, seerrApiKey }` and uses a separate client instance; it never replaces saved settings.

The API helper sends `X-Api-Key` to the configured Seerr endpoint, has a finite timeout, rejects redirects, handles non-success HTTP responses, and accepts empty 204 responses. Rejected redirects prevent credentials being forwarded to an unexpected destination; configure the final server URL.

## Configuration and migration

Active settings are `seerrUrl` and `overlayFeatures` in `storage.sync`, and `seerrApiKey` and `debugLogging` in `storage.local`. `debugLogging` is a Settings checkbox and gates all worker tracing; errors are never gated. The key is device-local because sync replicates through the browser account; the cost is re-entering it per device. Features default on unless explicitly false. Changes apply after Save Settings and trigger overlay cleanup/reinjection. The popup distinguishes missing configuration, ratings-only configuration, and request-enabled configuration.

Migration reads historical keys only in the worker. It fills active keys only when they are undefined, preserves an intentionally empty API key, and removes only historical keys after a successful write. The key is then copied to local storage before being removed from sync, so an interrupted migration leaves a duplicate rather than losing it. Storage failures are logged without deleting active settings. The actual implementation and worker runtime tests are authoritative.

## Host permissions

The seven supported sites are static `content_scripts` matches. Access to the Seerr server is an optional host permission, requested from the options page at the moment a URL is saved, because that origin is arbitrary. `permissions.request` must be the first await after the user gesture or Chrome rejects it.

Declining still saves settings; the options page then shows a standing notice. The worker reconciles registration on startup, on storage changes, and on `permissions.onAdded`/`onRemoved`, so revoking access removes the registration. Match patterns cannot carry a port, so the saved origin is reduced to `protocol//hostname/*`, which matches every port — a server on `:5055` would otherwise produce an invalid pattern.

## Identifying cards before they are hovered

[Seerr](https://github.com/seerr-team/seerr)'s title card keeps its link, its title and even its image `alt` inside a `Transition` that unmounts while the card is not hovered. An un-hovered card therefore exposes nothing but its poster image, and a card whose identity is unknown gets no badge and cannot be sorted or filtered. Hovering mounts the link, which is why scores used to appear one at a time under the cursor.

The page already fetches the data that identifies those cards, and its shape is configurable — the home page is up to twelve user-defined sliders — so guessing endpoints is unreliable. Instead `seerr-api-observer.js` runs in the page's own world at `document_start` and forwards what Seerr receives.

It is deliberately narrow. Only same-origin `/api/v1/` list endpoints are observed — `discover`, `search`, `request`, `media`, `movie`, `tv`, `collection`, `watchlist`, `blocklist` and `person`, matching Seerr's router — while `auth`, `user`, `settings`, `service`, `status` and the issue threads are excluded, so account data and user comments are never forwarded. Only a fixed field whitelist is projected, the item count is capped, and messages are posted to the page's own origin. The content script revalidates on receipt: same window, same origin, known channel, array payload. Observing never disturbs the page — the response body is cloned, and every failure path falls through to the page's own result.

Observed items and explicitly fetched lists accumulate into one bounded list, because either source may arrive first.

## Ratings resolution

Bundles contain `rtCriticsScore`, `rtAudienceScore`, `imdbRating`, `tmdbRating`, `confidence`, `source`, and `lastUpdated`. RT uses a 0–100 scale; IMDb/TMDB use 0–10. Zero is valid. Missing or invalid numeric scores are null.

Resolution preserves fields from earlier sources while filling missing fields:

1. Typed embedded media data.
2. Same-origin Seerr list data.
3. RT lookup through the worker when an RT field is missing.
4. Same-origin Seerr ratings/detail endpoints for remaining fields, stopping as soon as a bundle has every score. Seerr answers `/ratingscombined` with 404 only when it holds neither Rotten Tomatoes nor IMDb data, and `/ratings` with 404 when it holds no Rotten Tomatoes data, so a combined 404 guarantees the next call fails too and it is skipped. Each endpoint is also skipped when every field it could return is already known: combined supplies Rotten Tomatoes and IMDb, `/ratings` only Rotten Tomatoes, and the detail endpoint only the TMDB rating. A typical card arrives with a TMDB rating from the observed list and Rotten Tomatoes from the worker, so only IMDb remains and one request is made instead of three.

IMDb comes solely from `/ratingscombined`, and some servers have no reachable IMDb source, so that endpoint 404s for every title. After a sustained run of 404s the overlay stops asking for the rest of the session, since each ask costs a request and a console error for data that will not arrive. Any success resets the count, so an intermittent server is not abandoned, and **Refresh scores** clears it. `diagnose()` reports the state rather than leaving it invisible. This step runs once per card, so walking every endpoint regardless would multiply load on the server.
5. An empty bundle if no source yields scores.

Embedded and list indexes use media type plus ID to keep movie and TV identities separate. Ambiguous embedded objects may be ignored rather than assigned to the wrong title. Requests are matched on `media.tmdbId` only: Seerr's internal `media.id` is a sequential row id, and comparing it against a TMDB id matches unrelated titles.

Status lookups use a TMDB id supplied by the page when there is one, and fall back to title search otherwise. Search is heuristic and can resolve to the wrong title, so an exact id is always preferred.

Confidence applies to retained RT fields. Merging a trusted TMDB/IMDb score must not upgrade an approximate RT result. When RT fields have different confidence, the bundle conservatively uses the lower confidence. A single source label cannot fully describe mixed-source field provenance.

The overlay coalesces pending lookups and persists resolved bundles to `storage.local` under a single key, written with a short debounce. Those entries have no expiry: the entry cap is their only bound, eviction is least-recently-used, and Settings clears them. Each records when it was resolved, which the grid reports so a stale set is visible; entries written before that field existed load as a bare bundle with no recorded age. **Refresh scores** forgets the titles currently on screen and resolves them again, passing `refresh` through to the worker so its own 24-hour Rotten Tomatoes entry is discarded too — without that the score most likely to have moved is the one that would not. The overlay and Rotten Tomatoes caches are bounded separately (`overlayCacheMaxEntries`, `rtCacheMaxEntries`), since their entries differ in size and expiry and each cap also decides how large that cache's rewritten blob gets — at 5000 apiece they come to roughly 2 MB together, against a 10 MB default quota. A stored blob records which server it came from and is discarded on mismatch, and a bundle carrying no scores at all is never stored, since without an expiry that would mean never looking again. Because clearing is a key removal, the overlay treats only a removal as a clear and ignores its own writes. The worker separately coalesces identical RT title/type/year requests across callers. Positive RT results cache for 24 hours; low-confidence/no-match results for one hour. Rejections clear pending entries so later attempts can retry. Caches are bounded. The worker cache is written through to `storage.local` under a single key with a short debounce, because MV3 evicts the worker after seconds of idle and an in-memory map alone could never reach the 24-hour TTL. A corrupt or expired persisted entry degrades to a cold lookup. Network requests have a ten-second deadline.

RT search parsing and title matching are heuristic, not an official guaranteed RT API. Markup changes or ambiguous matches can yield no score or a wrong match.

## DOM lifecycle

The overlay only activates on the configured server origin and path. Grid routes are discover (including its trending and watchlist tabs), search, requests, a collection, a person's credits, the blocklist and the profile watchlist; movie and TV pages are detail routes. A route that is not recognised gets no badges and no controls, so this list is the boundary of where the overlay appears. Base paths are retained when constructing session API URLs.

History hooks, popstate, and polling detect route changes, including query-only navigation. The history patch is installed once per page, but the popstate listener and the polling fallback are per instance. Polling is needed because a content script’s isolated-world history patch may not see page-world calls. Route generations discard stale rendering work. Cleanup restores loaded card order and visibility, removes overlay elements, clears page indexes/selection, and disconnects observers. Page hide/show manages polling and observers for page restoration.

Cards without explicit links are matched to unique list titles, never by DOM position. Ambiguous matches remain unresolved.

Card data is retained separately from badges, allowing sorting with badges disabled. Async completion rechecks route generation and element connectivity. Detail callbacks recheck whether a row already exists to prevent concurrent duplication.

Sorting uses score plus original card index, keeps unrated titles last in both directions, and avoids DOM writes when order is already correct. RT critics, RT audience, TMDB and IMDb each sort and filter independently; the combined “Best Score” falls through RT critics, RT audience, TMDB, then IMDb, with the ten-point scales scaled to match. IMDb is read from the resolved bundle alone because cards render no IMDb badge to parse, and it is not gated on RT match confidence, which applies to title matching rather than to scores Seerr supplies. Filters treat unavailable scores as failing a positive minimum. Only loaded cards are affected; this is not server-side sorting or pagination.

## Bulk interaction

Selection uses card identity rather than array index. Keyboard-accessible selection buttons expose checkbox state. Review uses a labeled dialog, focus cycling, Escape handling, escaped title text, and explicit confirmation.

The batch accepts valid positive IDs with movie/TV types regardless of ratings. Requests are spaced 500 ms apart. Removing the modal or changing routes stops future submissions after any current request finishes. Seerr remains responsible for authorization, approvals, and duplicate handling.

## Build and validation

Make has one shared version prerequisite, so a combined parallel build increments once. Development dependencies stay outside packages. LICENSE is included in distribution files. The lockfile is committed for reproducible installation.

Tests include fast-check properties, worker execution in a VM, jsdom execution of production UI code and of the shared integration layer, and builds in temporary directories. Mocked API/DOM tests do not prove production site compatibility or authenticated server behavior. The Firefox manifest now uses the `background.scripts` module form, but has not been loaded in a running Firefox; see README.

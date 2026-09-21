# Super Seerr

Request movies and TV shows from the pages where you discover them, and bring Rotten Tomatoes ratings into your [Seerr](https://github.com/seerr-team/seerr) server. Seerr is the unified successor to Overseerr and Jellyseerr; servers on those earlier projects share the same API surface and should work too, though only Seerr is what this is developed against.

![Version](https://img.shields.io/badge/version-3.5.34-blue)

[Source](https://github.com/jonbiro/super-seerr-extension) · [Report a bug](https://github.com/jonbiro/super-seerr-extension/issues)

## Get started

1. Run `npm ci` and `make build` with Node.js 22.13 or newer and Make installed.
2. In Chrome, open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose `dist/chrome`.
3. Open Super Seerr’s **Settings**, enter your Seerr server URL, and click **Save Settings**.
4. Approve the permission prompt for your Seerr server. Super Seerr only asks for the one origin you saved, and the ratings overlay cannot run until you approve it.
5. Refresh Seerr. For request and Seerr-watchlist actions, add a Seerr API key from Seerr Settings → General → API Key. For the Plex Watchlist button, add a Plex token: sign in at app.plex.tv, open the DevTools Console (F12), run `localStorage.getItem('myPlexAccessToken')`, paste the value, then **Test Plex** to verify it.

If you dismiss the permission prompt, your settings are still saved and the site integrations keep working; Settings then shows a standing notice with a **Grant access** button. Changing the server URL asks again for the new origin and drops the old one.

**Test Connection** checks the entered URL and key without saving them. Editing a field does not save it; use **Save Settings** to apply changes. You can leave the API key empty for ratings-only mode. The toolbar shows **RT** for URL-only setup, **ON** for URL plus API key, and no badge when no URL is saved. These badges describe configuration, not server health.

After rebuilding, reload the extension in Chrome and refresh the pages using it. The local folder remains `dist/chrome`.

### Firefox status

`make build` also produces `dist/firefox`. Its manifest now uses the `background.scripts` module configuration [Mozilla documents for Firefox](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background) instead of the `service_worker` entry Firefox ignores, so the previously known-broken background configuration is fixed.

The real-extension smoke test passes in Firefox 147.0.3 with geckodriver 0.37.1: optional permissions, ratings injection, SPA navigation, addon reload, persisted cache clearing, and permission revocation. It also verifies an actual 3.5.2-to-current upgrade and manifest-driven integration on eleven synthetic movie/TV pages across all seven supported sites. These fixtures do not establish live-site compatibility. See [Firefox verification](docs/development.md#firefox-verification-opt-in) for prerequisites and remaining coverage.

## What it does

| Surface | Features |
| --- | --- |
| IMDb, Rotten Tomatoes, TMDB, Metacritic, Trakt, Filmweb | Movie/TV detection and a themed request flyout |
| Letterboxd | Movie detection and a themed request flyout |
| Your configured Seerr server | Ratings on cards and detail pages, quality summaries, sorting, filters, bulk review, and Plex Watchlist buttons on cards and movie/TV detail pages — on discover, search, requests, collections, people, the blocklist and your watchlist |

The flyout reports request status, supports Seerr watchlisting, offers a separate Plex Watchlist button when a Plex token is configured (visible even for available titles, where the Seerr button hides), and links to your media server when Seerr supplies a playable URL. Where a single lookup answers it — detail pages and the flyout — the Plex button shows the current state up front (`✓ On Plex Watchlist`, disabled) instead of an action; grids keep the lightweight add button, which reports an already-listed title distinctly when clicked. Seerr can be backed by Plex, Jellyfin or Emby; Super Seerr asks your server which one it uses and names it accordingly, or says simply “Watch” if it cannot tell. Those are separate products; their names and links are intentional. Seerr's watchlist and Plex's Universal Watchlist are different lists: the extension writes the first via your Seerr server and the second via plex.tv with your Plex token.

Requests only use a known TMDB ID or an unambiguous title/type/year match. If matching is uncertain, **Choose title** opens a keyboard-accessible picker with matching titles, years, types, and descriptions. Selecting a match checks its availability; a separate request click is still required. Cancelling or navigating away sends no request. Failed status lookups offer **Retry status**, not a media request. A lost response to a request is an unknown outcome: check Seerr before requesting again; the extension never automatically resends that POST.

### Ratings and sorting

Seerr's title cards hide their link and title until you hover them, so Super Seerr reads the title lists Seerr has already fetched to identify the cards on screen. It watches only same-origin `/api/v1/` list responses on your server, never anything about your account or your issue threads, and forwards a fixed set of fields. Lists that arrive before settings finish loading wait briefly and replay instead of being dropped.

On a supported Seerr grid, choose **Sort titles → RT critics: highest first** or an audience, TMDB or IMDb option. Both directions are available. Unrated titles stay last; ties retain their original relative order. **Original order** restores the initial order; **Reset** also clears filters. Sorting updates as ratings arrive.

Sorting and filtering apply to loaded cards in the grid associated with the controls, not to the entire server catalogue or pages that have not loaded. Separate carousels may not share one control bar. DOM layout changes in Seerr can affect card detection.

Ratings you have already seen are cached on your device and displayed immediately on return. Aging scores refresh quietly, and missing sources retry sooner. The title lists behind the cards persist too, so a cold load still identifies cards before Seerr's own lists arrive, and pending writes flush when the page unloads rather than dying with it. Scores move as reviews arrive, so the grid controls show when the loaded titles were cached and offer **Refresh scores**, which refetches just those titles. For everything at once, **Settings → Troubleshooting → Clear ratings cache** forces a fresh lookup, and takes effect in open Seerr tabs without a reload. Changing your server URL discards them automatically.

Scores are partial data: missing values stay absent. An unrated or unreleased title shows no IMDb or TMDB score rather than zero, since those scales treat zero as “not rated”; a 0% from Rotten Tomatoes is shown, because there it is a real verdict. RT matches below the confidence threshold are hidden; approximate accepted matches have a `~` prefix. A score without `~` matched the title exactly in the expected year. Where a title is shared by more than one film and no year is known, no score is shown rather than a guess. Summary labels are heuristics, not official RT certification. External title matching can still be wrong, especially for remakes or missing years.

### Bulk requests

Choose **Select titles**, select cards, then **Review & Request**. Titles with missing or invalid identities are excluded; missing ratings do not exclude a title. Submissions are spaced 500 ms apart and Seerr still controls permissions and approvals. Cancel or press Escape to stop subsequent requests; an already-sent request cannot be recalled.

### Preferences

Settings includes separate switches for card badges, detail ratings, summaries, sort/filter controls, bulk selection, and Plex Watchlist buttons. Save to apply them. Hiding card badges does not disable sorting by their underlying scores.

### Saved presets and score details

Save a named preset in the filter bar to reuse its sorting and score thresholds. Presets sync with your browser profile; select one to apply it or delete it from the same controls.

Each card and detail page offers **Score details** with its source, last check, missing-score explanation, and a retry button. Cached ratings appear immediately while older results refresh in the background. Partial ratings retry sooner, and a failed refresh keeps known scores visible.

The external-site flyout supports keyboard opening with Enter or Space, Escape to close, and focus return to its toggle. Hidden flyout controls stay out of the tab order.

## Development

```sh
npm ci                 # Install the locked development dependencies
npm run check          # Parse source scripts and verify manifest file paths
npm test               # Unit, property, worker, DOM, and build tests
npx playwright install chromium  # One-time browser download
npm run test:browser   # Real Chromium extension smoke tests (no version bump)
npm run test:firefox   # Opt-in Firefox harness; requires Firefox and geckodriver
make build             # Increment version; build both unpacked variants
make build-chrome      # Increment version; build Chrome only
make build-firefox     # Increment version; build Firefox only
make release           # Increment version; produce zip/xpi archives
make clean             # Remove generated dist and Super Seerr archives
```

Each Make build invocation increments the patch version once. A combined or parallel build shares that version across both browsers. The base manifest, package metadata, lockfile, and README badge stay synchronized. Tests and cleanup do not increment the working tree’s version. A failed build can consume a version. Run separate Make invocations sequentially in a checkout.

Release files are `super-seerr-v<version>-chrome.zip` and `super-seerr-v<version>-firefox.xpi`. A generated XPI is not a signed or approved store release.

Runtime scripts are plain JavaScript; no bundler or provider API subscription is required. `SeerrClient.js` sends messages to the background worker. jsdom, fast-check, and Playwright are development-only dependencies and are not packaged. See [runtime modules and browser testing](docs/development.md) for the module boundaries and smoke-test scope.

See [architecture](docs/design.md), [requirements and limits](docs/requirements.md), [verification workflow](docs/tasks.md), and [troubleshooting](docs/troubleshooting.md).

## Data and permissions

Seerr requests use your configured URL and API key. Overlay session requests use the logged-in Seerr page session. RT lookup sends a title search to Rotten Tomatoes. Plex Watchlist adds resolve the title through Plex Discover and write via plex.tv, authenticated with your Plex token.

Super Seerr does not request access to all websites. The site integrations run only on the seven supported sites listed above. Because a self-hosted Seerr can live on any domain, access to your server is an *optional* permission requested at the moment you save its URL, and the overlay is registered against that one origin at runtime. Revoking the permission in your browser removes the overlay registration.

The server URL and your feature toggles use browser sync storage, so they follow your browser profile across devices. **The API key and the Plex token are stored in device-local storage and do not sync** — enter them once per device. An API key saved by an earlier version is moved out of sync storage automatically on upgrade. Saving a Plex token also requests host permission for plex.tv, without which Plex actions cannot reach the network; declining still saves everything else. Treat exported profiles and shared machines accordingly.

No telemetry service is configured by this project. The background worker is quiet by default; **Settings → Troubleshooting → Verbose logging** turns tracing on while you reproduce a problem. Debug output can include media titles and server responses, so review logs before sharing them.

## License

MIT; see [LICENSE](LICENSE). Required attribution is retained and included in build packages. Historical connection-key names remain only for compatibility and regression testing.

### Connection checks and local history

The popup reports Seerr connectivity, host access, API-key acceptance, and Plex separately. Each issue links to the relevant setting. **Check connections** retries these read-only checks.

**Recent actions** shows the last 50 confirmed requests and Seerr/Plex watchlist additions on this device, with a clear-history button. History stores only action type, title, media type, and time; it does not sync or store credentials, API responses, or error bodies. Failed or uncertain requests are not presented as successes. Clearing history does not undo server actions.

### TV season requests

Use **Choose TV seasons** in a TV flyout to see availability and select seasons, including when other seasons are already available. Only the selected seasons are requested after confirmation. Bulk review requires a season choice for each TV title before the final request button enables. Cancelling or navigating away sends nothing further.

Availability is for standard quality. Already available, partially available, pending, processing, or already-requested seasons are disabled. The worker refreshes availability before posting; if it changed, review again. Specials require support in your Seerr settings. These restrictions follow [Seerr's request handling](https://github.com/seerr-team/seerr/blob/develop/server/entity/MediaRequest.ts).

### Storage isolation

Content scripts access cached ratings through worker messages restricted to the configured Seerr origin and base path. The worker validates and bounds the cache schema; it never returns arbitrary local storage. Cache clearing is limited to extension pages and serialized with cache writes. Settings-change notifications contain no keys or tokens.

Where `storage.local.setAccessLevel` is available, local storage is restricted to trusted extension contexts before initialization. Chromium verification confirms content-script key reads are rejected. Firefox 147.0.3 lacks this API: the worker bridge works, but API-enforced local-storage isolation is unavailable there. This distinction follows the browser's [storage access controls](https://developer.chrome.com/docs/extensions/reference/api/storage#type-AccessLevel), not a claim that Firefox provides the same restriction.

### Faster grids, remembered matches, and support

Card ratings use a four-job queue per page, prioritizing visible cards before
cards farther from the viewport. Scrolling reprioritizes waiting work. Navigation
and page exit discard queued jobs, abort page-side Seerr rating reads, and prevent
later lookup stages from starting. A Rotten Tomatoes worker read already in flight
may finish because other tabs can share it; abandoned cards are not repainted.

In **Choose title**, select **Remember this match on this device** to reuse a
correction. The choice is scoped to the original title/type/year and server,
stored locally, and revalidated against current candidates before application.
Settings → **Saved matches and support** lets you inspect and forget it. Reload
the source page after forgetting a match. A saved choice never submits a request.

**Recent actions → Refresh statuses** checks current Seerr status and provides
**Open in Seerr** links for new actions with a known TMDB ID on the current server.
Older entries without IDs and entries from a different server keep their historical
record without guessing a link. An offline server does not erase confirmed actions.

Settings → **Prepare diagnostic report** previews a JSON report before downloading.
It contains extension version, check time, storage-isolation capability, and the
four connection-check states. It excludes server addresses, credentials, media
titles, history, saved matches and raw errors. Nothing is uploaded automatically.

For downloadable packages, checksums and optional Firefox signing, see
[release preparation](docs/releases.md).

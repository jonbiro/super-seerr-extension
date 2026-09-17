# Super Seerr

Request movies and TV shows from the pages where you discover them, and bring Rotten Tomatoes ratings into your [Seerr](https://github.com/seerr-team/seerr) server. Seerr is the unified successor to Overseerr and Jellyseerr; servers on those earlier projects share the same API surface and should work too, though only Seerr is what this is developed against.

![Version](https://img.shields.io/badge/version-3.1.35-blue)

[Source](https://github.com/jonbiro/super-seerr-extension) · [Report a bug](https://github.com/jonbiro/super-seerr-extension/issues)

## Get started

1. Run `npm ci` and `make build` with Node.js 22.13 or newer and Make installed.
2. In Chrome, open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose `dist/chrome`.
3. Open Super Seerr’s **Settings**, enter your Seerr server URL, and click **Save Settings**.
4. Approve the permission prompt for your Seerr server. Super Seerr only asks for the one origin you saved, and the ratings overlay cannot run until you approve it.
5. Refresh Seerr. For request and watchlist actions, add a Seerr API key from Seerr Settings → General → API Key.

If you dismiss the permission prompt, your settings are still saved and the site integrations keep working; Settings then shows a standing notice with a **Grant access** button. Changing the server URL asks again for the new origin and drops the old one.

**Test Connection** checks the entered URL and key without saving them. Editing a field does not save it; use **Save Settings** to apply changes. You can leave the API key empty for ratings-only mode. The toolbar shows **RT** for URL-only setup, **ON** for URL plus API key, and no badge when no URL is saved. These badges describe configuration, not server health.

After rebuilding, reload the extension in Chrome and refresh the pages using it. The local folder remains `dist/chrome`.

### Firefox status

`make build` also produces `dist/firefox`. Its manifest now uses the `background.scripts` module configuration [Mozilla documents for Firefox](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background) instead of the `service_worker` entry Firefox ignores, so the previously known-broken background configuration is fixed.

This has **not been validated against a running Firefox**. The manifest is correct in principle; nobody has yet loaded the package in Firefox and exercised requests, the overlay, or dynamic script registration. Packaging success is not proof of Firefox compatibility. Treat Firefox as untested until someone reports otherwise.

## What it does

| Surface | Features |
| --- | --- |
| IMDb, Rotten Tomatoes, TMDB, Metacritic, Trakt, Filmweb | Movie/TV detection and a themed request flyout |
| Letterboxd | Movie detection and a themed request flyout |
| Your configured Seerr server | Ratings on cards and detail pages, quality summaries, sorting, filters, bulk review — on discover, search, requests, collections, people, the blocklist and your watchlist |

The flyout reports request status, supports watchlisting, and links to your media server when Seerr supplies a playable URL. Seerr can be backed by Plex, Jellyfin or Emby; Super Seerr asks your server which one it uses and names it accordingly, or says simply “Watch” if it cannot tell. Those are separate products; their names and links are intentional.

### Ratings and sorting

Seerr's title cards hide their link and title until you hover them, so Super Seerr reads the title lists Seerr has already fetched to identify the cards on screen. It watches only same-origin `/api/v1/` list responses on your server, never anything about your account or your issue threads, and forwards a fixed set of fields.

On a supported Seerr grid, choose **Sort titles → RT critics: highest first** or an audience, TMDB or IMDb option. Both directions are available. Unrated titles stay last; ties retain their original relative order. **Original order** restores the initial order; **Reset** also clears filters. Sorting updates as ratings arrive.

Sorting and filtering apply to loaded cards in the grid associated with the controls, not to the entire server catalogue or pages that have not loaded. Separate carousels may not share one control bar. DOM layout changes in Seerr can affect card detection.

Ratings you have already seen are cached on your device, so returning to Seerr does not look them up again. They do not expire. Scores move as reviews arrive, so the grid controls show when the loaded titles were cached and offer **Refresh scores**, which refetches just those titles. For everything at once, **Settings → Troubleshooting → Clear ratings cache** forces a fresh lookup, and takes effect in open Seerr tabs without a reload. Changing your server URL discards them automatically.

Scores are partial data: missing values stay absent. RT matches below the confidence threshold are hidden; approximate accepted matches have a `~` prefix. Summary labels are heuristics, not official RT certification. External title matching can still be wrong, especially for remakes or missing years.

### Bulk requests

Choose **Select titles**, select cards, then **Review & Request**. Titles with missing or invalid identities are excluded; missing ratings do not exclude a title. Submissions are spaced 500 ms apart and Seerr still controls permissions and approvals. Cancel or press Escape to stop subsequent requests; an already-sent request cannot be recalled.

### Preferences

Settings includes separate switches for card badges, detail ratings, summaries, sort/filter controls, and bulk selection. Save to apply them. Hiding card badges does not disable sorting by their underlying scores.

## Development

```sh
npm ci                 # Install the locked development dependencies
npm run check          # Parse source scripts and verify manifest file paths
npm test               # Unit, property, worker, DOM, and build tests
make build             # Increment version; build both unpacked variants
make build-chrome      # Increment version; build Chrome only
make build-firefox     # Increment version; build Firefox only
make release           # Increment version; produce zip/xpi archives
make clean             # Remove generated dist and Super Seerr archives
```

Each Make build invocation increments the patch version once. A combined or parallel build shares that version across both browsers. The base manifest, package metadata, lockfile, and README badge stay synchronized. Tests and cleanup do not increment the working tree’s version. A failed build can consume a version. Run separate Make invocations sequentially in a checkout.

Release files are `super-seerr-v<version>-chrome.zip` and `super-seerr-v<version>-firefox.xpi`. A generated XPI is not a signed or approved store release.

Runtime scripts are plain JavaScript; no bundler or provider API subscription is required. `SeerrClient.js` sends messages to the background worker. jsdom and fast-check are development-only dependencies and are not packaged.

See [architecture](docs/design.md), [requirements and limits](docs/requirements.md), [verification workflow](docs/tasks.md), and [troubleshooting](docs/troubleshooting.md).

## Data and permissions

Seerr requests use your configured URL and API key. Overlay session requests use the logged-in Seerr page session. RT lookup sends a title search to Rotten Tomatoes.

Super Seerr does not request access to all websites. The site integrations run only on the seven supported sites listed above. Because a self-hosted Seerr can live on any domain, access to your server is an *optional* permission requested at the moment you save its URL, and the overlay is registered against that one origin at runtime. Revoking the permission in your browser removes the overlay registration.

The server URL and your feature toggles use browser sync storage, so they follow your browser profile across devices. **The API key is stored in device-local storage and does not sync** — enter it once per device. An API key saved by an earlier version is moved out of sync storage automatically on upgrade. Treat exported profiles and shared machines accordingly.

No telemetry service is configured by this project. The background worker is quiet by default; **Settings → Troubleshooting → Verbose logging** turns tracing on while you reproduce a problem. Debug output can include media titles and server responses, so review logs before sharing them.

## License

MIT; see [LICENSE](LICENSE). Required attribution is retained and included in build packages. Historical connection-key names remain only for compatibility and regression testing.

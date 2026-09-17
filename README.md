# Super Seerr

Request movies and TV shows from the pages where you discover them, and bring Rotten Tomatoes ratings into your Seerr server.

![Version](https://img.shields.io/badge/version-3.1.10-blue)

[Source](https://github.com/jonbiro/super-seerr-extension) · [Report a bug](https://github.com/jonbiro/super-seerr-extension/issues)

## Get started

1. Run `npm ci` and `make build` with Node.js 22.13 or newer and Make installed.
2. In Chrome, open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose `dist/chrome`.
3. Open Super Seerr’s **Settings**, enter your Seerr server URL, and click **Save Settings**.
4. Refresh Seerr. For request and watchlist actions, add a Seerr API key from Seerr Settings → General → API Key.

**Test Connection** checks the entered URL and key without saving them. Editing a field does not save it; use **Save Settings** to apply changes. You can leave the API key empty for ratings-only mode. The toolbar shows **RT** for URL-only setup, **ON** for URL plus API key, and no badge when no URL is saved. These badges describe configuration, not server health.

After rebuilding, reload the extension in Chrome and refresh the pages using it. The local folder remains `dist/chrome`.

### Firefox limitation

`make build` also produces `dist/firefox`. Its current manifest retains the requested `background.service_worker` configuration. [Mozilla documents that Firefox does not support that entry](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background), so this package is not ready for Firefox runtime use. It needs a background module script configuration and browser validation. Packaging success is not proof of Firefox compatibility.

## What it does

| Surface | Features |
| --- | --- |
| IMDb, Rotten Tomatoes, TMDB, Metacritic, Trakt, Filmweb | Movie/TV detection and a themed request flyout |
| Letterboxd | Movie detection and a themed request flyout |
| Your configured Seerr server | Ratings on cards and detail pages, quality summaries, sorting, filters, bulk review |

The flyout reports request status, supports watchlisting, and links to Jellyfin when a playable URL is supplied by Seerr. Jellyfin is a separate product; its name and links are intentional.

### Ratings and sorting

On a supported Seerr grid, choose **Sort titles → RT critics: highest first** or an audience-score option. Both directions are available. Unrated titles stay last; ties retain their original relative order. **Original order** restores the initial order; **Reset** also clears filters. Sorting updates as ratings arrive.

Sorting and filtering apply to loaded cards in the grid associated with the controls, not to the entire server catalogue or pages that have not loaded. Separate carousels may not share one control bar. DOM layout changes in Seerr can affect card detection.

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

Seerr requests use your configured URL and API key. Overlay session requests use the logged-in Seerr page session. RT lookup sends a title search to Rotten Tomatoes. Broad URL matching accommodates self-hosted Seerr domains; the overlay checks your configured origin and path before injecting its interface.

Connection settings use browser sync storage, including the API key. Treat exported profiles and shared machines accordingly. No telemetry service is configured by this project. Debug output can include media titles and server responses; review logs before sharing them.

## License

MIT; see [LICENSE](LICENSE). Required attribution is retained and included in build packages. Historical connection-key names remain only for compatibility and regression testing.

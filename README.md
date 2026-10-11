# Super Seerr 🍿

**Request the movies and TV shows you discover, without losing your place.** Super Seerr adds media-request controls to seven discovery sites and brings ratings, sorting, watchlists and bulk actions to your own [Seerr](https://github.com/seerr-team/seerr) server.

[![Current version](https://img.shields.io/badge/version-3.5.230-blue)](CHANGELOG.md)
[![CI](https://github.com/jonbiro/super-seerr-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/jonbiro/super-seerr-extension/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**[Get started](#install-from-source)** · **[Features](#what-you-can-do)** · **[User guide](docs/user-guide.md)** · **[Troubleshooting](docs/troubleshooting.md)** · **[Report an issue](https://github.com/jonbiro/super-seerr-extension/issues)**

> **Distribution status:** This is an actively developed browser extension that you can build and load yourself. The repository does **not** currently offer a verified, approved Chrome Web Store / Firefox Add-ons release or a publicly published, signed, auto-updating package. A GitHub draft release is not an installed or published release. See [release preparation](docs/releases.md).

## See it in action

| Request from IMDb | Request from Rotten Tomatoes |
| --- | --- |
| ![An earlier Super Seerr/Jellyseerr-era request flyout showing an available film on IMDb](https://raw.githubusercontent.com/jonbiro/super-seerr-extension/master/.github/readme-images/imdb-flyout.webp) | ![An earlier request flyout opening over a Rotten Tomatoes movie page](https://raw.githubusercontent.com/jonbiro/super-seerr-extension/master/.github/readme-images/rotten-tomatoes-flyout.webp) |

*Real historical captures from an earlier integration build. The screenshots show legacy Jellyseerr labeling; the current extension is **Super Seerr**, targets **Seerr**, and may look different as the extension and host pages evolve.*

## What you can do

| Where | What Super Seerr adds |
| --- | --- |
| **IMDb, Rotten Tomatoes, TMDB, Metacritic, Trakt, Filmweb** | Find a movie or TV title and open a request flyout, where the page provides enough identifying information. |
| **Letterboxd** | Request matching **movies** from their Letterboxd pages. |
| **Your configured Seerr server** | Rotten Tomatoes/IMDb/TMDB ratings on cards and detail pages; sorting, filters and reusable presets; bulk request review; quality summaries; and optional Plex Universal Watchlist buttons. |

### Thoughtful request flow

- **Check availability before acting.** The flyout can show an existing request, what's available, and a playable link when Seerr supplies one.
- **No risky guessing.** Known TMDB IDs and unambiguous title/type/year matches can proceed; uncertain matches open **Choose title** for explicit review.
- **Separate approval from selection.** Choosing a match or a TV season does **not** automatically submit it. You confirm the request.
- **Batch carefully.** Select titles in Seerr, review the proposed requests, and stop remaining submissions with Cancel or Escape.
- **Watchlist choices stay distinct.** Seerr's watchlist and Plex's Universal Watchlist are separate systems. Plex integration is optional.

### Ratings that explain themselves

Sort loaded Seerr cards by RT critics/audience, TMDB, or IMDb scores; filter by ratings; or restore the original order. Unrated titles stay last. **Score details** shows the source, freshness, and the reason a score might be missing. An approximate Rotten Tomatoes match is marked with **~**; uncertain matches are hidden rather than presented as definitive.

Scores and card indexes are cached on your device for quicker return visits. Use **Refresh scores** on a grid or **Settings → Troubleshooting → Clear ratings cache** to force new lookups. These controls affect the *loaded cards in a particular grid*, not your entire Seerr library.

## Install from source

You'll need **Node.js 22.13+**, npm, Make, and a modern browser. No cloud account or paid rating API subscription is needed to build the extension; interacting with Seerr still requires access to your own server.

~~~sh
git clone https://github.com/jonbiro/super-seerr-extension.git
cd super-seerr-extension
npm ci
make build
~~~

**Note:** Every `make build` invocation increments the local patch version and updates `manifest.base.json`, `package.json`, `package-lock.json`, and this README's version badge. That's intentional for the development workflow; don't accidentally commit the bump with unrelated work.

**Chrome / Chromium:** Go to `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the generated `dist/chrome` directory. After later builds, reload the extension and refresh any open media/Seerr tabs.

**Firefox (temporary developer install):** `make build` also produces `dist/firefox`. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → select `dist/firefox/manifest.json`. Temporary installs do not provide store signing or automatic updates. The Firefox fixture-based extension harness has passed, but complete live-site and device compatibility is **not** established.

No approved browser-store download or public signed release should be assumed from the build outputs. See [release and signing notes](docs/releases.md).

## Connect your Seerr server

1. Open the extension's **Settings**, enter the full `https://` or `http://` URL of your Seerr server (including any base path), and select **Save Settings**.
2. Approve the **optional permission for that server origin**. If declined, the connection can still be saved, but the Seerr-page overlay cannot appear until you choose **Grant access**.
3. **Ratings-only mode:** A saved server URL and your normal logged-in Seerr session are sufficient for the on-Seerr enhancement mode; an API key is not required.
4. **Requests:** Add your Seerr API key (**Seerr → Settings → General → API Key**) and save it. The external-site flyouts then use that connection for status and request actions.
5. **Optional Plex Watchlist:** Add your own Plex token in Settings and approve the separate Plex host permission to enable Universal Watchlist actions.

You can save **up to ten Seerr sites** and switch the **one active destination** from the popup. Requests never broadcast to all saved servers. Connection tests are read-only and **do not save** your edits; choose **Save Settings** to apply changes.

The underlying server can use Plex, Jellyfin, or Emby for playback; Super Seerr displays the link Seerr returns. Older Overseerr/Jellyseerr servers have a similar API surface but are **not the primary verified compatibility target**.

For multi-site changes, Plex setup, TV-season requests, bulk review, saved presets, recent actions and cache controls, see the **[complete user guide](docs/user-guide.md)**.

## Privacy and permissions

Super Seerr runs in your browser and talks to the sites/services you choose; **no project telemetry service is configured**.

- It does **not** request blanket access to every website. Media-site integrations are limited to the seven supported sites; your self-hosted Seerr origin is authorized separately when you save its URL.
- **Seerr API keys and the Plex token are stored locally on the device**, not synced as browser preferences. Treat them like passwords. Saved site configurations also remain local when using multiple/named sites.
- Rotten Tomatoes queries send media-title searches to Rotten Tomatoes. Requests are sent to **your chosen Seerr server**. Plex watchlist actions reach Plex only when configured.
- Ratings, confirmed recent-action history and saved matches are stored locally with bounded caches. Debug logs can include titles or server responses; review them before sharing.

Read **[Data, storage and permissions](docs/privacy-and-permissions.md)** for exact boundaries, including differences between Chromium and Firefox storage-access controls.

## Developers and contributors

~~~sh
npm ci
npm run check           # Source/manifest path checks
npm test                # Unit, property and DOM/worker tests
npx playwright install chromium
npm run test:browser    # Chromium extension smoke tests with isolated fixtures
npm run test:firefox    # Optional; requires Firefox + geckodriver
make build              # Bump version and package unpacked Chrome/Firefox outputs
make release            # Bump version, build archive artifacts/checksums
~~~

Runtime modules are plain JavaScript rather than a bundled frontend; [`SeerrClient.js`](src/shared/SeerrClient.js) communicates with the background worker. The development-only test dependencies are not included in the installed extension.

Automated tests use local fixtures and temporary extension profiles—**passing them is not proof of compatibility with every live media site or a real Seerr server**. A separate opt-in read-only live-site check documents blocked pages rather than marking them as passes.

| Documentation | What it covers |
| --- | --- |
| [User guide](docs/user-guide.md) | Setup, multiple sites, requests, ratings, presets, seasons, history |
| [Troubleshooting](docs/troubleshooting.md) | Missing overlays/scores, permissions, connection failures, diagnostics |
| [Privacy & permissions](docs/privacy-and-permissions.md) | Data flows, browser permissions, keys, local/sync storage and caches |
| [Development](docs/development.md) | Runtime modules, safety contracts, unit/browser/Firefox verification |
| [Architecture](docs/design.md) | Worker, DOM, data model, integration boundaries |
| [Requirements & limits](docs/requirements.md) | Acceptance criteria and compatibility constraints |
| [Live-site checks](docs/live-site-checks.md) | Sampled, read-only external-site verification and blocked cases |
| [Release preparation](docs/releases.md) | ZIP/XPI packaging, checksums, signing and store requirements |
| [Changelog](CHANGELOG.md) | Version history |

## Support and license

Found a problem? [Open a GitHub issue](https://github.com/jonbiro/super-seerr-extension/issues) with your **extension version, browser version, page URL/route (remove private server details), expected behavior and sanitized screenshot**. Never post API keys, Plex tokens or personal server logs.

**MIT licensed** — see [LICENSE](LICENSE). Super Seerr is an independent project; Seerr, Plex, Rotten Tomatoes and the supported discovery sites belong to their respective owners.

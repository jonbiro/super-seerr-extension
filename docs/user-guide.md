# Super Seerr user guide

This guide covers the current extension's settings and behavior. For an overview and the source-install steps, start with the [project README](../README.md). For permissions and data handling, see [Privacy and permissions](privacy-and-permissions.md).

> **Development distribution:** Super Seerr can be built and loaded manually. Browser-store approval, public signing, cross-browser coverage and automatic updates have not been established. See [release preparation](releases.md).

## Before you begin

You need access to **your own Seerr server**. Seerr is the primary tested API target; Overseerr/Jellyseerr may share endpoints but are not a guarantee of compatibility.

| What you want | Configuration needed |
| --- | --- |
| Ratings, sorting and filters **on Seerr pages** | Saved server URL, origin permission and an authenticated Seerr browser session |
| Look up status and **request a title** from IMDb or another supported site | Saved server URL **plus Seerr API key** |
| Add a title to **Plex Universal Watchlist** | Separately configured Plex token and plex.tv host permission |

The extension does **not** choose a media server for you. Your Seerr server determines its own Plex, Jellyfin, or Emby backend and, when available, supplies the playback URL.

## Install and update

Run from a clone of the [source repository](https://github.com/jonbiro/super-seerr-extension):

~~~sh
npm ci
make build
~~~

Load `dist/chrome` from **Chrome → Extensions → Developer mode → Load unpacked**. For a *temporary* Firefox install, open `about:debugging#/runtime/this-firefox`, select **Load Temporary Add-on**, and choose `dist/firefox/manifest.json`.

After changing the source and rebuilding, **reload the extension**, then refresh any already-open Seerr and discovery pages. Some permissions or overlay registration changes require reloading the affected Seerr tab.

After a Firefox upgrade, newly supported discovery sites can require a separate site-access approval. In Firefox's extension/add-on permissions controls, allow Super Seerr on Simkl or JustWatch, then reload that title page. Existing site permissions do not prove access to a newly added host.

**Developer workflow note:** `make build` increments the patch version and updates the manifest, package metadata, lockfile and README badge; it is not a read-only command. A failed build can still consume a version. Avoid concurrent, separate Make invocations in the same checkout.

Chrome is the primary browser CI target. Firefox's extension harness was checked with Firefox 157.0.1 and geckodriver 0.37.1 against local fixtures; complete real-world site/device verification is still outstanding. See [Firefox verification](development.md#firefox-verification-opt-in).

## Configure Seerr

1. Open the Super Seerr popup and select **Settings**.
2. In **Seerr sites**, enter the final Seerr server URL, including `http://` or `https://`, port and any base path.
3. Optionally enter a display name such as *Home*.
4. Click **Test Connection** to check the entered values without changing your active configuration.
5. Click **Save Settings** to save and activate the connection. Approve the browser's optional permission to access that server origin.

Do not include a username/password, query string, or fragment in the server URL. URL redirects may cause connection validation to fail; use the final URL.

If you refuse the host permission, other configured settings can be saved, but the Seerr-page enhancement cannot run. **Settings → Grant access** lets you request the permission again. After changing the server origin, approve permission for the new one and reload the page.

### Ratings-only, then requesting

For **ratings-only mode**, save the server URL without an API key and open a Seerr page while signed in normally. Card/detail ratings and supported controls use the Seerr page session.

To **request media** or perform API-key-based actions from an external discovery page, obtain the key under **Seerr → Settings → General → API Key**, enter it in Super Seerr Settings, and click **Save Settings**. The key stays local to that device.

The toolbar can show **RT** (URL saved but no API key), **ON** (URL and API key saved), or no badge. These describe configuration, **not a live health guarantee**. Use the popup's **Connection checks** when something does not work.

**Test Connection** never silently saves field edits; choose **Save Settings** when ready.

### Save and switch multiple Seerr sites

You can save **up to ten** named Seerr connections. In Settings:

- **Add another site** keeps the current saved entry while creating a new one.
- **Saved sites** selects an existing entry to edit; **Save Settings** saves those edits **and activates** that site.
- **Use selected site** activates the chosen saved entry **without saving unsaved field changes**.
- To remove a saved site, make **another site active**, then select the inactive entry and click **Remove selected site**.

The popup's **Active Seerr site** selector switches destinations. **Only one connection is active** for requests, watchlists, ratings overlays and status checks; a request is never broadcast to all saved sites. When switching, the extension discards prior-site dialogs or stale results rather than submitting them elsewhere. If an overlay is absent immediately after switching, refresh the Seerr tab.

Named/multiple site lists, their URLs, active choice and per-site keys remain on the device. Each site keeps its own Seerr-specific ratings/title caches; confirmed action history remains available after removing a connection. The same device-level Plex token is used across sites.

## Request from supported discovery sites

| Website | Scope |
| --- | --- |
| IMDb | Movies and TV when the page provides sufficient identifying metadata |
| Rotten Tomatoes | Movies and TV |
| TMDB / The Movie Database | Movies and TV |
| Metacritic | Movies and TV |
| Trakt | Movies and TV |
| Filmweb | Films and series, including Polish titles |
| Letterboxd | **Movies only** |
| Simkl | Movies and TV; anime only when its metadata explicitly identifies a movie or TV series |
| JustWatch | Supported movie/TV title pages and localized routes; season/episode pages are excluded |

On a supported title page, open Super Seerr's themed flyout. It shows identification details and media/request status, and may offer a playback link from Seerr when a title is already available. Super Seerr names the underlying server as Plex, Jellyfin or Emby when Seerr reports it, rather than assuming every setup uses Jellyfin.

**Important:** Supported page patterns do not mean every live title, country or changing website layout is guaranteed to work. See [sampled live-site checks](live-site-checks.md). A site reporting HTTP 403 or an obstructing consent dialog is **blocked**, not a passed integration test.

### Uncertain title matches are never automatically requested

A known TMDB ID is preferred. Otherwise, the extension requires a sufficiently unambiguous **title + media type + year** match. Search variants may help find candidates but do not loosen the identity rule.

If multiple titles could match, click **Choose title**. The picker shows candidate titles, years, media types and descriptions. Selecting a candidate only refreshes its availability; **you must click the request action separately**.

Choose **Remember this match on this device** if you want a corrected choice reused for the same source title/type/year and server. It is revalidated against candidates on reuse; it never submits automatically. Review or remove saved corrections under **Settings → Saved matches and support**, then reload the source page.

A missing or failed status response is not “available” or “not found”; choose **Retry status**. A request POST is sent only once. If a response is lost, the result is *unknown*: check Seerr's requests before trying again. The extension does not automatically resend the submission. Navigating away or canceling a picker does not submit anything.

### Request selected TV seasons

In a TV flyout choose **Choose TV seasons** to review seasons, including when some seasons are already present. Mark exactly what you want and confirm.

Already available, pending, partially available, processing or already-requested seasons are not offered as new requests. Seerr settings determine specials handling. Availability is checked again before posting; if it changed, review the selection again. For a TV show in bulk review, season selection is required before the final confirmation enables.

These actions use Seerr's normal permissions and approval workflow; Super Seerr cannot bypass them.

## Plex Universal Watchlist is a separate option

Seerr's own watchlist is **not** the same as Plex's Universal Watchlist.

For the Plex option, sign in at `app.plex.tv`, open the browser's developer console on that page and run:

~~~js
localStorage.getItem('myPlexAccessToken')
~~~

Copy the returned token only into **Super Seerr → Settings → Plex Token**, then click **Test Plex** and **Save Settings**. This token is a credential: do not paste it into issues or logs, and do not share screenshots that display it. Plex access additionally requires the optional `plex.tv` host permission.

The **Plex Watchlist** button can appear on grids and movie/TV detail pages even if the title is already available through Seerr and a Seerr request button would be hidden. In a detail view or flyout where a lookup has already established the state, an item on your list shows **✓ On Plex Watchlist** rather than a second action; grids use a lighter-weight button and report an already-listed title when clicked.

The extension resolves the Plex Discover item conservatively, preferring a TMDB-linked identity and rejecting ambiguous title-only matches. These actions contact Plex and affect **your Plex account**, not Seerr's watchlist.

## Ratings, sorting and filters inside Seerr

Super Seerr enhances supported Seerr grids and title pages, including Discover, Search, Requests, Collections, People, Blocklist and Watchlist views where compatible cards are present.

### What the scores mean

- Rotten Tomatoes **critic** and **audience** scores are separate values. A genuine **0% RT score** is displayed; an unrated/missing value is not represented as zero.
- Missing IMDb or TMDB values are absent rather than “0”, since that would imply a real rating.
- Rotten Tomatoes matches below the confidence threshold are hidden. Accepted approximate matches show **~**; an exact title/year match has no tilde.
- Ratings and quality summaries are informational and heuristic. They are not official Rotten Tomatoes certifications, and an external title match may still be wrong.

Use **Score details** on a card or detail page to inspect source, last check, missing-score reasoning and an individual retry.

### Sort, filter and save a preset

Use **Sort titles** to order the loaded cards by Rotten Tomatoes critics/audience, TMDB or IMDb, in either direction. Unrated cards stay last and ties preserve their prior relative order. **Original order** restores the page ordering; **Reset** clears filters as well.

Filters and saved named presets let you reuse score thresholds and sorting choices. Presets can be selected or deleted from the filter bar; they sync as browser preferences. Turning off visible card ratings does **not** turn off underlying rating-based sorting.

Sorting applies only to the **currently loaded cards for the connected grid**. It does not sort unseen pagination, your entire media server catalogue or every carousel at once. Seerr's DOM and network response shapes can change and may temporarily prevent card identification.

### Cache behavior and manual refresh

Previously seen ratings can appear immediately after you return; stale data refreshes in the background. A full scored bundle typically refreshes after **24 hours**, a partial bundle after about **one hour**; missing scores and failed lookups retry on shorter schedules. See the [requirements](requirements.md) for details.

The extension keeps Seerr-specific title lists and ratings separately by server address/port/base path, and can share *verified public RT data* by media type and TMDB ID when title and release-year identity also matches. Shared public data has its own bounded cache/freshness timer; an unrelated server's private/session data is not treated as public.

The per-server cache is bounded for up to ten sites, roughly **600 KB per site**; the public provider and RT title caches are independently bounded to approximately **1 MB each**. The extension retains recent items when space is limited.

Use **Refresh scores** in a grid to refetch only its loaded titles. Use **Settings → Troubleshooting → Clear ratings cache** to clear all saved sites' ratings caches and public caches. Open Seerr tabs are notified and discard the old values.

### Bulk request review

Select **Select titles** on a supported Seerr grid, mark cards, then choose **Review & Request**. Missing/invalid identity excludes a title; lack of ratings alone does not.

Submissions are spaced about **500 ms** apart. You can press **Cancel** or **Escape** to stop *future* requests, but one already submitted cannot be recalled. Review handles TV season selection and respects Seerr's approval system.

## Controls, diagnostics and recent actions

The external flyout opens via keyboard **Enter/Space** and closes with **Escape**, returning focus to its toggle. Review dialogs, pickers and settings expose keyboard controls; report any focus or screen-reader regression.

The popup separates read-only checks for **Seerr availability, origin permission, API key acceptance and Plex connection**. **Check connections** re-runs those checks.

**Recent actions** stores the last **50 confirmed** media requests and Seerr/Plex watchlist additions on the local device (action, title, type and time). It omits failed or uncertain requests, API responses and credentials. **Clear history** removes those local entries but **does not undo a server-side action**.

**Recent actions → Refresh statuses** reads current Seerr state for entries with known TMDB IDs on the active server, and can show **Open in Seerr** when an unambiguous link is available. Older or other-server entries keep their record without guessing.

**Settings → Prepare diagnostic report** previews a report before you download it. It includes version, check time, storage-isolation capability and connection-state results, but excludes credentials, private server URLs, media titles, history, saved matches and raw error bodies. Nothing uploads automatically.

To investigate a Seerr card whose title is not detected, open the *regular page's developer console* and run:

~~~js
await superSeerrDiagnose()
~~~

The report exposes counts for observed list responses, unresolved cards and rejected shapes. Zero observed messages usually means the required origin permission was not granted when the page loaded. A rejected or ambiguous title should not become a guessed request.

For step-by-step remedies, including wrong/stale scores, browser permissions, denied requests, host-site errors and handling diagnostic logs, see **[Troubleshooting](troubleshooting.md)**.

## Notes on privacy and compatibility

This is a personal browser extension talking to **your** Seerr server, supported public websites, and optionally Plex; no project telemetry service is configured. Keys and the Plex token stay locally stored on your device, while some harmless display preferences may sync through your browser profile. See [Privacy and permissions](privacy-and-permissions.md).

Firefox currently uses a documented background-script configuration and has passed synthetic real-extension verification, but signed distribution, automatic updates, physical-device use and comprehensive live-site coverage are **not** confirmed. For current development and verification methods, see [Development](development.md).

## Trakt, Simkl and JustWatch

See [Tracker accounts and discovery](tracker-integrations.md) for app registration and manual watchlist sync. Simkl and JustWatch title pages now offer the same availability/request flyout as existing discovery sites. The Explore this title disclosure opens search destinations and lets you pick a JustWatch country. Season/episode pages with no clear parent identity and ambiguous anime formats are deliberately left without a request flyout.

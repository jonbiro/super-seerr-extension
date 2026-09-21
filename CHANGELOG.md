# Changelog

All notable changes to the Super Seerr extension will be documented in this file.

Versions are produced by `make build`, which increments the patch number. Add
notes under the version a change actually ships in rather than inventing a new
heading per change.

## [3.5.7]

- TV flyouts and bulk requests now offer season selection with existing standard-quality availability before confirmation. TV requests send an explicit season array instead of requesting all seasons.
- Available, partial, processing, pending, and existing requested seasons cannot be selected. The worker refreshes availability before a write and refuses changed or invalid selections.
- Season review supports keyboard navigation, cancellation, and navigation cleanup. A separate TV season button remains available when the main action opens the media server.

## [3.5.6]

- Ambiguous titles open an in-extension picker with release year, type, and description. Candidate lookup retains strict identity matching and returns only display fields.
- A selection checks the chosen title's status; it never sends a request automatically. Escape, cancellation, and navigation dismiss the picker without writing.
- Added worker, DOM, and Chromium coverage proving a separate request click sends the selected TMDB ID exactly once.

## [3.5.5]

- Popup diagnostics separate Seerr reachability, host permission, API-key rejection, and optional Plex configuration, with repair links focused on the relevant Settings control.
- Added a device-local list of the last 50 confirmed requests and watchlist additions, with clear history. Only title, media type, action type, and time are retained; history storage failure cannot report a successful server action as failed.
- Chromium and Firefox real-extension fixture tests now exercise popup diagnostics and history rendering/clearing; Chromium also verifies Settings repair focus and missing host access.

## [3.5.3]

- Cached ratings display immediately while aging full or partial bundles refresh in the background; failed refreshes preserve known scores and retry sooner.
- Score details explain missing, failed, or uncertain lookups, show source and last-check time, and support retrying one title.
- Named filter presets save, apply, update, and delete score thresholds and sorting.
- Concurrent Seerr status reads share work, with short-lived request-history/detail caches invalidated around writes and configuration changes.
- Flyouts use keyboard-accessible buttons, announce expanded state, support Escape, and restore focus when closed.
- Fixed Firefox content-script helper exports so the ratings overlay initializes in Firefox's separate global and window contexts. The real Firefox smoke test now passes alongside Chromium coverage.

## [3.5.2]

- Requests retain their own in-flight guard across navigation; an old success or failure cannot unlock or relabel a newer request.
- Seerr and Plex watchlist actions ignore duplicate clicks while pending and discard UI updates for a previous page.
- Late watch lookups and delayed request UI callbacks no longer act on a different title after navigation. Cached watch links open directly from the click instead of a timer.
- Saving a Plex token and Seerr URL requests their host permissions together, preserving the click gesture and retaining existing grants when the combined request is declined.

## [3.5.1]

- Seerr watchlist actions resolve title-only entries using title, type, and year, and reject ambiguous matches.
- Slow Plex state lookups no longer block Seerr controls; stale replies cannot overwrite newer actions.
- Missing ratings no longer suppress unrelated movies or shows, and legacy server-wide suppression is removed.
- Navigation replaces an expanded flyout with the current title; stale extractions cannot overwrite the new page, and destruction removes open panels.
- Test Plex requests host access before testing an unsaved token and explains declined access without issuing a network request.

## [3.5.0]

- Options: the Plex Token hint and its Show/Test Plex buttons no longer collide. The hint flows full-width with the actions on their own row.

- Request lookup pages past the first hundred: older requests no longer read as unrequested (and re-requestable) on servers with long histories. Capped at ten pages.
- A hung ratings lookup can no longer pin its card forever: resolution now races a 30s deadline, goes provisional, and retries, instead of awaiting a dead channel for the session.
- Navigating away mid-request no longer wedges the next page's request button shut.
- Bulk review with nothing requestable can no longer confirm an empty request.
- A blocked watch popup now warns instead of reporting an opening that never happened.
- Destroyed integrations run nothing: extraction retries, navigation rebuilds, and status renders all stand down once destroyed instead of resurrecting UI.
- A page id contradicted by Seerr (another title, another year) no longer spends its write: requests and statuses fall back to title search instead of trusting first-external-link extraction.
- Toasts no longer pile on the same corner coordinates: flyout and overlay notifications share a capped corner column, so bursts stay readable.
- Double-clicking Save Settings saves once and prompts once instead of firing a second permission prompt with no gesture left to answer it.
- Repeated identical title lists no longer make a card ambiguous to itself: duplicates collapse to their shared identity at match time, while genuinely different titles sharing a poster still refuse.
- Card identification no longer scans every stored title per card per pass: a poster/title index rebuilt only when the lists change keeps steady-state passes to lookups (~70× faster on large grids), which was starving the main thread into kill-or-wait dialogs.
- The page-world observer no longer leaks an unhandled rejection when a response body cannot be cloned; the page still reads its own response.

- Ratings survive hard reloads onto the cards, not just into storage. The title index behind the cards now persists with the scores (bounded separately), so a cold load identifies un-hovered cards before Seerr's own lists arrive, and pending writes flush on unload instead of dying with the page. Cleared and server-switched the same way scores are.
- Lists Seerr speaks before settings finish loading are stashed briefly and replayed once the server is known, instead of being dropped as unidentifiable.

## [3.1.62]

- Seerr grid cards gained a Plex Watchlist button: one small `＋` per identified card on discover, search, requests, watchlist and other title grids. It resolves by TMDB id against Plex Discover and refuses unresolvable cards rather than guessing. Bulk request selection stands the card buttons down while its checkboxes own the corner, then restores them.

## [3.1.61]

- True Plex Watchlist support, separate from Seerr's own watchlist. Save a Plex token in Settings (device-local, never synced) and a `＋ Add to Plex Watchlist` button appears on Seerr movie/TV detail pages and in the external-site flyout — including for available titles, where the Seerr watchlist button hides. Resolution confirms the TMDB GUID via Discover metadata and refuses ambiguous title-only matches; the add is a single PUT with already-on-watchlist reported distinctly.

## [3.1.60]

- Score badges moved from the top right of a card to the bottom right. Seerr puts its own status badge there — the green tick on an available title — and ours sat on top of it. With two scores showing, the critics score now takes the upper position so the pair reads in the same order as the detail page.
- The scores fade out while a card is hovered. The bottom edge is where Seerr puts the Request button on a title you do not have, so they step aside rather than covering it.

## [3.1.59]

- Added a “Load 500 more” button to the filter bar. Sorting can only order what is rendered, so a grid you have scrolled a third of the way through sorts a third of the results. The button pulls in up to five hundred further titles and scores them, after which sorting and the score filters cover the whole grid. Scores land in the ordinary cache, so a second visit is instant.
- The run reports progress on the button itself and stops when clicked again. It ends early when the list runs out, and scores in batches so a self-hosted Seerr is not asked about five hundred titles at once.

## [3.1.58]

- Rotten Tomatoes page fetches now queue, at most three at a time. A grid resolves fifty cards at once and each is one or two page fetches, so they all arrived together — the shape bot protection is built to notice, and a real session was answered with HTTP 403. Nothing here is urgent enough to need them all at once.
- A refusal now names the page that was refused. “Rotten Tomatoes returned HTTP 403” alone cannot tell the search page apart from a title's own page, and they are protected differently.

## [3.1.57]

- Fixed an uncaught DataCloneError from the diagnostics bridge. The report crosses a postMessage, which structure-clones it, and it included the card's matched anchor element — a DOM node cannot be cloned, so the report never arrived and the caller timed out blaming an overlay that was running fine. Only the identity fields are sent now, and a failure to send is reported rather than thrown away.
- Rotten Tomatoes lookups now pause after a run of refusals. It sits behind bot protection and answered a real session with HTTP 403; a grid of fifty cards would keep asking through the whole block, which cannot succeed and invites a longer one. Nothing is cached as unrated meanwhile — a refused request is not a verdict on the title.

## [3.1.56]

- Fixed “Clear ratings cache” being undone by a lookup running at the same time. The clear empties memory and then removes storage, and a read starting in between restored the entries it was deleting, which the next write then put back on disk. A read now waits for a clear already under way.
- The media server is named again on the first status after the worker restarts. Manifest V3 evicts that worker after seconds of idle, and the name was re-fetched each time without being waited for, so the flyout regularly fell back to a bare “Watch”. The last answer for a server is remembered and used immediately, then refreshed behind it — still without holding up any message.

## [3.1.54]

- A lookup that could not complete is now held for two minutes in memory rather than retried on every pass. Not remembering failures at all, as the previous build did, meant a page re-asked about the same titles each time badges were injected. The hold never reaches storage and never outlives the page, so a server coming back is picked up at once.
- A 500 from Seerr is no longer treated as “this title has no ratings”. Only a 404 says that; any other failed response means the server did not answer.

- Fixed a regression in the previous build: a lookup that could not complete was remembered as “nothing knows this title”, hiding real scores for a week. A worker answering “no match” and a worker that could not answer both produced the same empty result, and Manifest V3 evicts that worker after seconds of idle, so failures mid-burst are ordinary rather than rare. Only an answer is remembered now. Absences written by the previous build are discarded on upgrade, since there is no way to tell which of them were real.

- Fixed “Add to Watchlist”, which never worked. Seerr validates the request with a schema requiring `tmdbId` and `mediaType`; the extension sent `mediaId`, a field that schema has no place for, so every add was rejected. The title is now sent too, as Seerr's own front end does. The test that covered this asserted the broken shape against a body builder written inside the test, so it could never have caught it; it now drives the worker and checks what is actually sent.

- Titles that nothing has rated are now remembered as such for a week. The overlay stored only scores, so every visit to the same page re-ran the same lookups for the same unrated titles and drew the same 404s from Seerr's ratings endpoints. The absence expires, because a film nobody has reviewed yet is unrated only for now, and “Refresh scores” forgets it at once.

- `superSeerrDiagnose()` now reports how many ratings requests the overlay itself issued. Seerr's own front end asks the same endpoints for the same missing data, so a console full of 404s cannot be attributed by reading it.

- Fixed rating badges appearing on things that are not titles. A detail page's external-links row points at `themoviedb.org/movie/1241982`, whose path is the same shape as Seerr's own `/movie/:id`, so the raw href matched and the TMDB logo was treated as a card. Links are now resolved and required to be same-origin.
- Stopped relearning that a server has no ratings backend on every page load. Giving up after repeated 404s only lasted as long as the page, so each navigation spent a dozen failed requests and a dozen red console lines per endpoint reaching the same conclusion. The verdict is now remembered per server for a day, and a stale one is retested with a single request rather than another dozen. Clearing the cache or pressing “Refresh scores” forgets it immediately.
- Cached scores are now re-resolved when the matching rules change, in both caches that hold one. A stored bundle carries the confidence the matcher gave it and a cache hit never re-runs the matcher, so titles cached before the Rotten Tomatoes match was tightened kept displaying a “~” however exact the match had become — the overlay's cache indefinitely, and the worker's own Rotten Tomatoes cache for a day. Both now record which rules scored them, and entries stamped with anything else are looked up again.

## [3.1.45]

- Fixed detail pages reporting a correct Rotten Tomatoes score as approximate. A Seerr heading reads “Moana 2 (2024)”, and that whole string was used as the title while the year was discarded — so an exact match registered as a partial one and wore a `~`. A parenthesised trailing year is now split off and used as the year. Numbers that belong to the title, as in “Blade Runner 2049”, are left alone.

## [3.1.44]

- Rotten Tomatoes lookups now also use a title's original name. Rotten Tomatoes lists most films under their English title, so a Seerr configured for another language, or a site like Filmweb, supplied a name it does not carry and no score was found. Results are also judged against every title the film is known by rather than against the query, so a localised search that returns the English title is now recognised instead of rejected. A title matching its original, including one differing only by accent, is still searched once.

## [3.1.43]

- Fixed titles outside plain English never matching on Rotten Tomatoes. Normalisation kept only `a-z`, so an accent became a space that split the word — *Amélie* became `am lie`, *Podziemny krąg* became `podziemny kr g` — and a title in any non-Latin script became an empty string that could not match anything at all. Accents are now folded to their base letter, the Latin letters carrying no combining mark are mapped, and letters of any script are kept. This most affects Filmweb.pl, which is Polish, and any title shown in a language other than English.

## [3.1.42]

- Added coverage for the release year reaching the Rotten Tomatoes lookup, which is what separates a film from its own remake. A card withholds its year until hovered, so the year has to arrive from the list data Seerr fetches for itself; nothing had tested that it does.

## [3.1.41]

- Fixed the `~` approximate marker appearing on every Rotten Tomatoes score. Confidence could not exceed 0.97, so full certainty was unreachable and the marker never distinguished anything. An exact title in the expected year now scores 1 and is shown plainly.
- Stopped guessing between films that share a title. Several films can carry the same title exactly — *Moana* is both a 2016 feature and a 1926 documentary — and with no year to choose between them the score shown was whichever Rotten Tomatoes ranked first. Where that ambiguity exists and no year is known, no score is shown.

## [3.1.40]

- Fixed the previous release moving its 404s rather than stopping them. Skipping `/ratings` relied on `/ratingscombined` being asked first and failing, so once the latter was given up on, that signal never fired and every card asked `/ratings` instead. Both endpoints are now given up on together.
- Fixed a second case that would never have stopped: Seerr answers `/ratingscombined` with 200 when it holds either source, so a server with IMDb but no Rotten Tomatoes succeeded there and failed on `/ratings` for every card, with each success clearing the count. Failures are now tracked per endpoint.

## [3.1.39]

- The popup now says something different depending on what you have set up. Every state shared one description, so once you had added an API key it still told you what an API key would let you do. It now reads **Ready to request** when requests are available and **Ratings are on** when only the server URL is saved, each describing what you can actually do rather than announcing that the extension is running.

## [3.1.38]

- A selected card now shows a tick. Selection was signalled by fill colour alone, which is unreadable to anyone who cannot distinguish the two colours.
- Fixed the bulk bar breaking "3 selected" and "Review & Request" across two lines.

## [3.1.37]

- Moved the permission notice in Settings above the form. It explains why the ratings overlay is not running, and sat below the action buttons where it was easy to miss entirely.
- Fixed action labels breaking across two lines inside their buttons.
- Removed **Skip for now** from Settings. It only closed the window, and dated from when this page opened itself on install; that flow is gone, so it invited you to skip something that was never being offered.

## [3.1.36]

- Unrated titles no longer show as `0/10`. TMDB and IMDb both report zero for a title nobody has rated, and the badge rendered that as a score — so an unreleased film read as damningly bad and sorted below genuine low ratings. Both scales start their votes at 1, so a zero is now treated as no rating. A Rotten Tomatoes 0% is still shown, because there it is a real verdict.

## [3.1.35]

- The request flyout now matches the site it appears on rather than your operating system. It chose its theme from `prefers-color-scheme`, but IMDb, Letterboxd, Trakt and Metacritic are dark whichever theme you run, so anyone with a light system setting got a white panel on a dark page. It now reads the page's own background, falling back to the system preference only when the page does not say.

## [3.1.34]

- Card badges now hold their contrast on any poster. A dark fill with no edge disappeared against dark artwork, which is common, and a blanket opacity weakened it further; the badge now carries a light edge and a shadow instead. Rendered against bright, busy, dark, near-black and washed-out posters to check.
- Tightened the detail-page ratings row, which was dimming its labels twice over, once on the row and again on each label.

## [3.1.32]

- Redesigned the grid controls. Labels sat at 55% opacity on a grey wash, and the sort control, the thresholds and the buttons all carried identical weight, so nothing was legible or findable. The bar is now a panel with recessed fields, labels at readable contrast, and buttons ranked by what they do — violet marks an action, Reset stays quiet.
- A threshold above zero now takes the colour of the score it filters, so the bar shows which filters are narrowing the grid instead of leaving that invisible. At rest it stays neutral.

## [3.1.29]

- Fixed the grid controls breaking apart when the bar wraps. Each label and its input were separate flex items, so at a narrower window a label could end one line with its own input starting the next — visible as a stranded "TMDB ≥" and a sort control truncated to "Origina". Labels and their controls are now single units, the sort control has room for its longest option, and the cache-age note is weighted as the supplementary text it is.

## [3.1.25]

- Stopped asking a server that cannot answer. IMDb ratings come only from Seerr's `/ratingscombined`, which reaches an external service; where that is unavailable the endpoint 404s for every title, costing one request and one console error per card for data that never arrives. After a sustained run of 404s the overlay stops asking for the session. Any success resets it, so an intermittent server is not abandoned, and **Refresh scores** makes it try again. `diagnose()` reports the state.


- The overlay now asks Seerr only for ratings it does not already have. Each endpoint supplies a known set of scores, and one whose fields are all in hand is skipped: a typical card arrives with a TMDB rating from the page's own list data and Rotten Tomatoes from the background worker, so only IMDb remains and it costs one request instead of three.
- Diagnostics are reachable as `await superSeerrDiagnose()` from the console's default context. They previously existed only in the extension's isolated world, which a DevTools console does not reach without changing its context dropdown — a debug tool you cannot open is not much of one.


- Stopped asking Seerr a question whose answer was already known. For a title with no ratings, the overlay requested `/ratingscombined` and then `/ratings`, but Seerr only returns 404 from the combined endpoint when it has neither Rotten Tomatoes nor IMDb data, which guarantees the second call fails too. That halves both the requests and the 404s the browser logs to the page console.


- `seerr_debug.ratings.diagnose()` now explains why a card has no score rather than only showing that it does not. It reports how many list responses the page-world observer has forwarded and from which paths, and for each unresolved card whether Seerr has withheld its link, whether its poster matched nothing observed, or whether it matched more than one title and so could not be resolved without guessing.


- The ratings overlay now works on every Seerr page that shows title cards. Collections, a person's credits, the blocklist and your profile watchlist were unrecognised routes, so they got no badges and no sort or filter controls.
- The flyout no longer claims everything is Jellyfin. Seerr supports Plex, Jellyfin and Emby and reports which is configured, so the label follows your server, and stays neutral when the type is unconfigured or unrecognised. The watch button is now identified by its class rather than its exact label, which that change would otherwise have broken.


- Fixed request status being read through the wrong table. Seerr has two status enums where the same number means different things, and request statuses were mapped as media statuses: a **declined** request reported "Processing download", a **failed** one reported "Partially ready", and a pending one reported "Status unclear". Each now maps through the table it belongs to, and a failed request offers a retry.
- Fixed blocklisted media being offered as requestable. `BLOCKLISTED` is new in Seerr and fell through to "Ready to request", where requesting could only fail. Deleted media stays requestable, and media of unknown status now offers the request rather than reporting itself unclear, matching Seerr's own cards.


- Widened the observed endpoint set to match Seerr's router, adding `blocklist` and `person`, whose pages also render title cards. Issue threads are excluded alongside the account endpoints, since they carry user comments.

- Fixed scores only appearing on the card under the cursor. Seerr keeps a title card's link, title and image `alt` inside a component that unmounts until the card is hovered, so an un-hovered card exposed nothing but its poster and could not be identified — which also left grid sorting and filtering with almost nothing to work with on the home page. A page-world observer now forwards the title lists Seerr fetches for itself, so cards resolve as the page loads. It reads only same-origin `/api/v1/` list responses, excludes anything about the account, projects a fixed field whitelist, and never alters the page's own requests.

## [3.1.18]

- Added **Refresh scores** to the grid controls, for titles whose scores have moved since they were cached. It forgets only the titles currently loaded and resolves them again, and passes the refresh through to the background worker so its own 24-hour Rotten Tomatoes entry is discarded as well — otherwise the score most likely to have changed would be served from cache regardless.
- Cached entries now record when they were resolved, and the grid reports the age of the loaded set, so there is a signal for when refreshing is worth it. Entries stored by earlier versions still load, without an age.

## [3.1.17]

- Fixed `retryDelay: 0` and `retryAttempts: 0` being silently replaced by their defaults, because the shared client defaulted with `||` rather than `??`. A caller asking for no backoff got a full second between retries. Attempt counts are also floored at one, so a zero can no longer skip the request entirely and return `undefined`.

- Raised both persistent caches from 500 to 5000 entries, and split the shared `cacheMaxEntries` into `overlayCacheMaxEntries` and `rtCacheMaxEntries`. The two hold different-sized entries under different expiry rules, and each cap also governs how large that cache's rewritten blob is, so one number for both was coincidence rather than design. At 5000 apiece they come to roughly 2 MB together against a 10 MB default quota.

## [3.1.16]

- Added IMDb to the grid sort and filter controls. The score was already fetched into every bundle and shown on detail pages, but was the one rating you could neither sort nor filter by. The combined **Best Score** sort now also falls through to IMDb, so a title carrying only an IMDb rating sorts by it instead of counting as unrated — which also means such titles now count towards the “scored” coverage figure.

## [3.1.15]

- Ratings the overlay has already resolved are now cached on the device instead of only in memory for five minutes, so revisiting Seerr no longer re-resolves every card. Entries do not expire; **Settings → Troubleshooting → Clear ratings cache** clears them and takes effect in open tabs. Entries are tagged with the server they came from and discarded if it changes, a bundle with no scores at all is never stored, and the 500-entry cap now evicts least-recently-used rather than oldest-inserted.

## [3.1.14]

- Fixed release-year extraction, which used a hardcoded `1[8-9]\d{2}|20[0-2]\d` range and would have silently stopped recognising years from 2030. The plausible range is now derived from the clock, so there is no cliff. The metadata path also accepted any four-digit run, reading `2160` out of `2160p`; both paths now share one bounded, word-anchored helper.
- Fixed a timer leak on all seven supported sites. `BaseIntegration.destroy()` existed but nothing ever called it, so the one-second SPA navigation poller and the popstate listener outlived the page. The poller is now released on `pagehide` and re-armed on `pageshow`.
- Fixed navigation detection for a second integration instance on one page: the double-patch guard returned early and skipped the per-instance popstate listener and polling fallback, not just the history patch it was meant to guard.
- `window.seerr_debug.<site>.mediaData` is a live getter rather than a snapshot taken before the first navigation.
- Added a jsdom harness for the shared content-script layer, which previously had no direct test coverage.
- Fixed request status being taken from an unrelated title. Request matching compared the page's TMDB id against Seerr's internal `media.id` row id as well as `media.tmdbId`; both are small sequential integers, so a collision showed another title's status and Jellyfin link. Matching is now on `tmdbId` alone, and tolerates Seerr returning it as a string.
- Status lookups now use a TMDB id the page already extracted instead of always running up to 19 fuzzy title searches, which were both slow and able to resolve to the wrong title. `requestMedia` already took this shortcut; `getMediaStatus` did not.
- Seerr ratings lookups stop once a bundle is complete rather than always walking every endpoint. This runs once per card, so a full grid could issue three times the necessary requests against a self-hosted server.
- Added extraction coverage for all seven site integrations, which previously had none despite depending on third-party markup. Each case asserts title, year, media type and ID from a representative page, with a decoy `document.title` so a broken selector cannot pass via the page-title fallback.
- Brought the architecture, requirements, task and troubleshooting docs back in line with the permission model, split storage, persisted worker cache and corrected Firefox manifest.
- Fixed title-search fallback mangling numeric titles. The digit/word swaps ran globally, so "Blade Runner 2049" generated "Blade Runner Two0Four9" and "2012" generated "Two01Two" — wasted sequential API calls that could also fuzzy-match the wrong title. The swaps are now word-anchored, so those titles produce a single term while "Toy Story 2" still also tries "Toy Story Two".
- Added a **Settings → Troubleshooting → Verbose logging** checkbox. Worker tracing was made opt-in in 3.1.11 but the flag was only reachable by hand-editing storage, which is not a usable control when the troubleshooting docs ask you to collect logs.
- Added a guard test so the API key cannot drift back into synced storage; only the migration may read it there.
- Added coverage for the options page, which had none despite owning the permission flow: that declining still saves, that the notice appears only when a server is saved without permission, that `permissions.request` runs before any storage write (Chrome rejects it once the user gesture is gone), that the requested pattern carries no port, and that the API key never reaches synced storage.
- Stopped resending a media request that Seerr had already answered. `requestMedia` is a non-idempotent POST but retried on any error, so a rejection such as "Request already exists" was sent up to three times, risking duplicate requests and making the user wait roughly four seconds before the error appeared. A reply now ends the attempt immediately; only a failed round trip, where nothing reached Seerr, is retried. Status lookups follow the same rule.

## [3.1.11]

Breaking for existing installs: the extension now asks for permission to run on your Seerr server, and the API key stops syncing between devices.

- The ratings overlay no longer runs on every site. The catch-all content script and the all-sites host permissions are gone; the overlay is registered at runtime against the one origin you save, behind an optional host permission requested when you save it. Declining still saves your settings and shows a standing **Grant access** notice in Settings.
- Rotten Tomatoes results now persist in local storage instead of a worker-memory map. MV3 evicts the worker after seconds of idle, so the configured 24-hour TTL previously expired on eviction and every revisit re-scraped two pages per title.
- The API key moved from synced storage to device-local storage and is migrated automatically on upgrade; it must be re-entered once on each additional device. The overlay no longer reads the key at all and asks the worker whether requests are available.
- The background worker is quiet by default. Roughly a hundred unconditional `console.log` calls, including full media payloads and per-variation search traces, are now behind an opt-in `debugLogging` flag. Errors still surface.
- Removed the unused `activeTab` permission; added `scripting`.
- Fixed the Firefox manifest to use `background.scripts` with `type: module` rather than the `service_worker` entry Firefox ignores. Still unvalidated on a running Firefox.
- Fixed a seed-dependent flaky property test that generated `NaN` ratings and asserted they round-tripped.
- Added CI running the syntax check, tests, and both browser builds; `npm run check` now also validates the dynamically registered overlay files and the permission shape.

## [3.1.10]

- Resolve poster-only Seerr cards using unique, exact poster paths from the session list API, so ratings and sorting work before titles or links appear.
- Added a regression with shuffled API results and an unidentified poster.

## [3.1.9]

- Fixed sorting on Seerr movie grids whose title cards are nested inside list items. Controls now target the complete list, and sorting, filtering, and Reset preserve card wrappers.
- Added a regression covering the live Seerr list structure, coverage counts, filtering, Reset, and disabling the overlay.

## [3.1.8]

- Added explicit saved overlay preferences and non-saving connection tests.
- Separated embedded/list ratings by movie/TV identity and preserved server base paths.
- Handled query-only navigation, cleanup, and page restoration.
- Added request deadlines, RT lookup coalescing, bounded caches, and invalid-score handling.
- Kept sorting available with badges hidden; improved keyboard selection and cancellable bulk dialogs.
- Added production DOM regressions, syntax/manifest checks, a committed dependency lockfile, and documentation in build packages.
- Replaced obsolete migration plans with current architecture, requirements, verification, and troubleshooting documentation.

## [3.1.5]

- Corrected historical migration examples to preserve active settings and shared client files.
- Clarified that ratings-only mode requires saving a server URL.
- Corrected documentation of worker initialization and Firefox compatibility.

## [3.1.4]

- Published project metadata and issue links for Super Seerr under jonbiro/super-seerr-extension.
- Removed obsolete branding screenshots and updated naming in the retained historical implementation documentation.
- Included the MIT license in build and release packages.
- Retained compatibility settings migration and required license attribution.

## [3.1.2]

- Named the extension Super Seerr across the manifest, popup, options, and flyout.
- Added automatic patch-version increments for builds and releases.
- Kept RT sorting active as ratings arrive; added stable original-order restoration.
- Fixed partial ratings, confidence handling, ratings-only status, and worker initialization.

## [3.0.0] - 2025-06-06

### ✨ Features

- **RT Ratings Overlay on Seerr**: Rotten Tomatoes scores injected on Seerr browse cards and detail pages so you can evaluate titles at the point of request. Preferences Seerr-native ratings data first; falls back to confidence-aware resolution.
- **RT-Based Sorting & Filtering**: Sort browse/search results by RT critics or audience score; filter by minimum critics/audience thresholds. Unrated titles pushed to the bottom.
- **Bulk List Actions**: Multi-select titles on Seerr browse/search pages and submit them as a single reviewed batch request. Confirmation modal with excluded-titles review.
- **Add to Watchlist**: Secondary button in the flyout panel to add media directly to your Seerr watchlist.
- **In-Library Badge**: Green checkmark badge next to the media title when content is already available on Jellyfin.
- **Browser Toolbar Badge**: Green "ON" / Red "OFF" indicator on the extension icon showing connection state.
- **Feature Flags**: Card badges, detail-row injection, pre-request summary, sort/filter, and bulk actions individually gateable without code changes.

### Naming and compatibility

- Standardized the SeerrClient shared library and SeerrAPI worker class.
- Migrated stored connection settings while preserving backward compatibility.
- Updated extension metadata, options, and popup presentation.
- Preserved Jellyfin media-server links.

### 🏗️ Architecture

- **ES Modules**: Background service worker uses `type: module` with asynchronous initialization. Listeners register synchronously; messages wait for settings
- **Firefox MV3**: The Firefox manifest retains `service_worker`; this remains an unresolved runtime compatibility limitation, as described in README
- **Native Promise API**: All `chrome.runtime.sendMessage` calls use native Promise-based API (~12 callback wrappers eliminated)
- **Shared Ratings Model**: `RatingsModel.js` (typed bundle with partial-data support) and `RatingsConfig.js` (centralized thresholds)
- **Seerr Overlay CSS**: `seerr-overlay.css` injected via manifest `css` array — matches Seerr's visual density, supports dark/light themes
- **Session Cache**: In-memory ratings cache with request coalescing (only 1 in-flight lookup per TMDB ID)

### 🧪 Test Infrastructure

- **33 tests passing**: Property-based tests (fast-check) + smoke tests + DOM-level regression tests
- `package.json` with `node --test` runner
- `tests/helpers/chrome-mock.js`: in-memory `chrome.storage.sync` mock for property testing
- Tests cover: storage migration (round-trip + idempotence), branding (current-brand consistency), debug namespace, tmdbId passthrough, watchlist visibility & POST body, badge idempotence, ratings model renderability, cache coalescing, summary heuristic, overlay injection idempotence, SPA navigation regression

### 🐛 Bug Fixes

- **Service worker init race**: Listeners now registered synchronously at top level — no lost messages on worker wake
- **Duplicate flyout**: `setupFlyoutUI` method overwrite fixed; `updateStatus` restored
- **Request button debounce**: Double-click protection prevents duplicate requests
- **Ratings cache poisoning**: Rejected promises no longer permanently block cache entries
- **Bulk request response check**: Checks `response.success` before counting requests as succeeded
- **IMDB selector**: Added resilient fallback for hashed CSS module class
- **Sort stability**: Identical scores use card index as tiebreaker
- **Memory leak**: `window.seerr_debug` entries cleaned up in `destroy()`
- **Polling leak**: Navigation interval stops on cleanup via `destroyed` flag
- **Options URL validation**: Rejects non-http/https protocols
- **24 additional bugs** found and fixed during two comprehensive forensic audits

### 🔧 Technical

- **TMDB ID passthrough**: `requestMedia()` accepts direct TMDB ID, skipping title search entirely
- **Bulk request rate limiting**: 500ms delay between sequential requests with live progress counter
- **SPA navigation**: Overlay re-injects on client-side route changes without duplicating elements
- **`innerHTML` → `textContent`**: Rating items built with DOM APIs; user-controlled text escaped in bulk confirmation modal
- **Error handling**: Unhandled Promise rejections eliminated from `setTimeout` callbacks; `.catch()` added to all `.then()` chains

---

## [2.0.0] - 2025-10-15

### ✨ Features
- **6-Site Integration**: Complete support for IMDb, Rotten Tomatoes, TheMovieDB, Letterboxd, Metacritic, and Trakt
- **Unified Flyout Interface**: Consistent design across all supported sites
- **Brand Theming**: Each site maintains its unique visual identity and colors
- **Smart Media Detection**: Automatic extraction of title, year, and media type from page content
- **Real-time Status**: Shows current request status with color-coded indicators
- **Intelligent Retry Logic**: Handles network issues and connection failures gracefully

### 🏗️ Architecture
- **Shared Library System**: Modern modular architecture using BaseIntegration, SeerrClient, MediaExtractor, and UIComponents
- **Manifest V3**: Full compliance with latest browser extension standards
- **Service Worker**: Background script handling for improved performance
- **Cross-Site Consistency**: Unified behavior and styling patterns

### 🎨 User Experience
- **Status Indicators**: Green (available), Orange (pending), Blue (downloading), Red (error)
- **Responsive Design**: Flyout adapts to different screen sizes
- **Clean Interface**: Minimal, non-intrusive design that doesn't interfere with website experience
- **Fast Performance**: Optimized for quick loading and low resource usage

### 🔧 Technical
- **Enhanced Error Handling**: Comprehensive error recovery and user feedback
- **API Integration**: Full integration with Seerr REST API
- **Multi-domain Support**: Works across all major movie/TV platforms
- **Development Framework**: Easy expansion system for adding new sites

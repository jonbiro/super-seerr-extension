# Changelog

All notable changes to the Super Seerr extension will be documented in this file.

Versions are produced by `make build`, which increments the patch number. Add
notes under the version a change actually ships in rather than inventing a new
heading per change.

## [3.5.97]

- Notify open Seerr pages when a changed verified public ratings snapshot has been persisted, without broadcasting scores, catalogue data or credentials.
- Refresh only the public cache tier and repaint affected titles without reloading the page or replacing server-specific IMDb/TMDB scores and live catalogue observations.
- Reject older public snapshots and replies crossing cache clears or server changes; bound refreshed public snapshots and preserve state through read failures.
- Add worker notification, write-recovery, public-refresh, contradictory-year and real Chromium two-open-page regressions using deterministic provider transport.

## [3.5.96]

- Recheck cancellation and card attachment immediately before executing a dispatched ratings job, preventing abandoned callbacks from starting between queue dispatch and execution.
- Release skipped jobs normally so current cards continue scoring, while keeping genuinely running work within the concurrency limit until it settles.
- Add dispatch-clear, dispatch-detach and running-concurrency regressions.

## [3.5.95]

- Stop canceled rating reads before cache access and after asynchronous prerequisites, including cached reads that would otherwise enqueue background refreshes.
- Prevent abandoned card work from restarting with a fresh queue signal after navigation or queue clearing, while retaining the existing cached score.
- Add regressions for cancellation before lookup, during cache loading and during availability loading.

## [3.5.94]

- Preserve confirmed Plex watchlist membership when restoring Seerr controls after loading, so a watchlisted title continues to show a disabled On Plex Watchlist button.
- Record membership after successful Plex adds and refresh it from current status reads without allowing late replies to cross a view change; retain confirmed state through unavailable reads, but clear it after confirmed removal or account disconnection.
- Clear membership when the title or connection changes, including collapsed-panel metadata refreshes and explicit title choices; add lookup, successful-add and identity-change regressions.

## [3.5.93]

- Validate playback destinations before opening them: accept absolute HTTP/HTTPS URLs and reject relative, malformed, executable or credential-bearing URLs.
- Restore Retry status with a clear warning when server metadata contains an invalid playback URL, instead of leaving the Watch button loading or opening the wrong site.
- Detach playback windows from the discovery page while preserving popup-blocker detection, with unit and real Chromium regression coverage.

## [3.5.92]

- Make explicit ratings refreshes supersede ordinary in-flight lookups while continuing to coalesce concurrent refreshes.
- Release obsolete card queue work when Refresh scores starts, so a full queue cannot delay fresh provider reads.
- Reject late replies from superseded lookups and add regression coverage for shared refreshes, queue saturation and refreshed card scores.

## [3.5.91]

- Settle canceled content-side ratings lookups immediately instead of waiting for a provider reply or the 30-second resolver deadline.
- Release abandoned card queue work promptly so a newly navigated page can start scoring; remove abort listeners and deadline timers when the bounded operation finishes.
- Preserve cache ownership checks so late replies cannot overwrite a fresh lookup after cancellation, and add shared-caller, retry and queue-release regressions.

## [3.5.90]

- Enrich anchored cards using catalogue metadata keyed by exact media type and TMDB ID, so known years reach rating lookups even when a card already has a link.
- Update live card titles, years and dependent actions when catalogue metadata changes; preserve selection for the unchanged identity and reject late lookups started with older metadata.
- Keep newly added duplicate cards on the existing shared ratings lookup instead of discarding another card's correct pending work.
- Add anchored-card, misleading-poster, movie/TV ID overlap, metadata-refresh, selection and late-response regressions.

## [3.5.89]

- Pass known catalogue years into card rating lookups, preventing public scores with contradictory release years from overwriting a server-specific cached bundle.
- Infer years from detail headings before shared-cache reconciliation, rather than only on provider lookup; explicit metadata years take precedence.
- Repair previously reconciled contradictory public RT fields when their source record is identifiable, keeping native scores visible while refetching.
- Apply the same year inference to title-only cache keys so refresh, forget and diagnostics continue to address the same entries.
- Add movie/TV card, matching-year, contradictory-year, explicit-year and title-only refresh regressions while preserving native IMDb fields.

## [3.5.88]

- Rank queued card ratings by distance from both viewport axes, fixing horizontally offscreen cards taking priority over visible titles.
- Deprioritize empty rectangles from filtered cards or hidden layout wrappers instead of treating them as visible at the page origin; still resolve them after rendered cards so score filters can recover unrated titles.
- Add queue ordering regressions and a Chromium test using actual card layout, horizontal overflow and a hidden wrapper.

## [3.5.87]

- Share the complete bounded ratings lookup between concurrent callers, including its deadline, cached-score fallback and cleanup, instead of exposing the raw provider promise to duplicate cards.
- Ensure every caller finishes when the provider deadline expires and every coalesced failed refresh retains the same previously known score.
- Add deterministic regressions for hung concurrent lookups and failed concurrent refreshes while preserving per-title and movie/TV separation.

## [3.5.86]

- Remove stale Seerr controls and cached snapshots when settings storage or the worker configuration read fails, instead of retaining the previous active site or falling back to a synced URL.
- Require a successful worker verdict with a valid HTTP(S) site URL (or an explicit inactive-site null); confirmed ratings-only configurations remain supported.
- Ignore obsolete configuration completions before rebuilding overlays, preserving the current toolbar and filter state when an older refresh fails late.
- Add regressions for storage/transport/worker failures, recovery, invalid replies and delayed refreshes.

## [3.5.85]

- Release discovery actions and invalidate pending replies when a page enters the browser's back/forward cache; rebuild restored panels using the current Seerr site and its saved title choice.
- Recheck configuration before restoring Seerr overlays, removing controls immediately when an installation is no longer active.
- Reload shared/public and server-specific rating snapshots on restoration, so missed cache clears or updates cannot leave a frozen tab pinned to stale in-memory ratings.
- Add lifecycle regressions for missed site-switch notifications and refreshed ratings at an unchanged URL.

## [3.5.84]

- Ignore null, unrelated media types and 4K entries in embedded request lists when deriving standard-quality request status; retain direct media availability when no relevant request exists.
- Reject malformed or out-of-range status enums with a read-only Retry Status action instead of showing misleading availability or allowing a new request.
- Clear cached Seerr reads on a retryable status failure so retries fetch fresh responses; keep late failures from an earlier site from evicting the active site's cache.
- Skip malformed season records when rendering TV monitoring information and add status, immediate-retry and cross-site cache regressions.

## [3.5.83]

- Recognize IMDb TV metadata in links, spans and list items, including hyphenated mini-series labels; ignore episode text in query strings, fragments and unrelated sidebar metadata when choosing movie versus TV controls.
- Prefer the IMDb title's own hero release year over unrelated year links, retaining years when hero metadata uses list items or spans.
- Decode Trakt fallback slugs without corrupting accented letters, retain the plausible release year removed from the slug, preserve numeric titles and non-year numeric suffixes, and refuse undecodable fallback identities.
- Add extraction and decoy regressions plus shared Chromium/Firefox fixtures for mini-series controls, misleading episode references and encoded Trakt title/year fallbacks.

## [3.5.82]

- Load remembered title choices using the current site's connection token before building discovery panels, fixing saved choices being ignored after switching sites.
- Re-extract the title if the selected site changes between the saved-match reply and the status lookup; rebuild open panels when their site changes even when the displayed title is identical, and discard late extraction/configuration replies.
- Keep status reads bound to their initiating site during ping and transport retries; a configuration read failure leaves a retryable error rather than allowing an unscoped lookup.
- Add site-switch, open-panel, delayed-reply, configuration-recovery and client retry regressions, plus Chromium coverage for two independent saved matches and correctly scoped requests from an actual IMDb integration fixture.

## [3.5.81]

- Treat malformed or non-object Rotten Tomatoes scorecard JSON as a failed detail read, preserving successful fallback scores and using the short retry window instead of promoting the attempt into the shared public cache.
- Accept single-quoted scorecard IDs and whitespace around attribute assignment; require the actual `id` attribute so an unrelated `data-id` script cannot supply the scores.
- Retire older rating verdicts that could have been created by these parser bugs while preserving the per-site catalogue indexes.
- Add real-parser failure, recovery, public-cache admission and zero-score regressions, plus Chromium coverage for malformed HTTP 200 responses and alternate valid scorecard markup.

## [3.5.80]

- Retry failed Rotten Tomatoes detail reads after two minutes instead of retaining failed or partial responses for an hour; apply the shorter retry window to persisted failures from earlier versions.
- Retain unexpired successful title-cache scores during a refresh and after search or detail transport failures, keeping their original age and expiry so other tabs and sites can continue using them without duplicate lookups.
- Add failure, retry, refresh overlap, expiry and cold-restart regressions plus Chromium coverage using deterministic provider responses with the actual extension worker and storage.

## [3.5.79]

- Invalidate recycled card identities when their poster or visible title changes without a replacement link; remove stale badges, selections and Plex actions, and ignore late results for the previous title.
- Drop cached identities when a card points outside the active installation, preventing poster-based fallback from restoring ratings or actions on a rejected link.
- Revalidate bulk selection before copying titles into confirmation, excluding cards deselected by identity changes rather than substituting their replacements.
- Observe poster and title updates so badges refresh automatically, while retaining identities across hover-only link removal and responsive poster size/query changes.
- Add action, selection, late-result and hover regressions plus Chromium checks for automatic poster recycling and nested-site link changes.

## [3.5.78]

- Recognize movie and TV card links beneath the configured Seerr base path, keeping parent/sibling installation links out of nested-site overlays; reject malformed IDs and links containing credentials.
- Reject redirects during session-authenticated catalogue and ratings reads so a login page or another installation cannot populate the active site's cache.
- Add real HTTP redirect regressions and Chromium coverage for active nested-site badges, shared public score reuse and blocked cross-installation reads.

## [3.5.77]

- Keep one recent catalogue entry per movie/TV identity, replacing stale titles and posters while retaining original titles, years and other metadata omitted by partial responses; repeated lists no longer crowd other titles out of the cache.
- Preserve explicit years when restoring and projecting stored title indexes, keeping movie and TV IDs separate.
- Invalidate pending saved-title-choice reads and writes after switching sites, switching away and back, or editing the active site's credentials, including operations delayed by storage reads or queued writes.
- Add catalogue update/cold-reload and saved-choice race regressions, including real Chromium persistence and poster-only card coverage.

## [3.5.76]

- Revalidate observed title API URLs against the active Seerr origin and base path before accepting catalogue or rating data; reject other installations, credentials in URLs, and non-title endpoints.
- Recheck site configuration during SPA navigation so entering an inactive nested installation removes the parent overlay and returning restores it; block injection while checking and ignore late navigation results.
- Use the browser's current tab URL for Seerr message routing because a content script's sender URL can retain its pre-navigation address; reject requests and cache access from inactive nested SPA pages.
- Preserve the active site's bounded title index during same-site navigation so poster-only cards retain their identities, fixing inferred media types before a later route can reinterpret them; still clear the index when the configured server changes or caches are cleared.
- Fix live title-index persistence: the cache callback now projects the current catalogue when called without arguments, restoring poster-only identities and cached badges after a cold reload.
- Add cross-server observation, base-path persistence and rapid-navigation regressions, plus a real Chromium nested-site SPA round trip.

## [3.5.75]

- Merge concurrent cache writes using separate public-score and server-check timestamps, preserving newer RT scores alongside newer server-local IMDb/TMDB values and confidence for only the RT fields retained.
- Prevent an older tab from forgetting a public score that another tab updated without changing the server's check time.
- Update the Settings cache count and Clear button as other tabs write or clear caches, ignore stale count reads, and label the total as cache entries rather than distinct titles.
- Add concurrent-source, deletion, confidence and Settings regressions, with real Chromium worker/storage coverage for combined source updates and live cache counts.

## [3.5.74]

- Respect failed-refresh backoff after a shared public score expires, keeping known scores visible without repeatedly retrying on every badge pass.
- Prefer newer worker RT scores over an older partial tab snapshot while preserving server-local IMDb/TMDB values; keep source timestamps from moving backward or advancing for rejected low-confidence matches.
- Add regressions for expired-score failures, newer and older worker results, low-confidence matches, and persistence of the corrected scores.

## [3.5.73]

- Share independently verified Rotten Tomatoes scores across Seerr sites by media type and TMDB ID, including localized titles, while retaining separate server ratings, requests, availability and catalogue indexes.
- Reject equally strong RT candidates even when the release year is known, and invalidate earlier matcher verdicts before they can seed shared results.
- Admit only exact title/original-title and year matches into the public tier, preserving source timestamps and expiry; reject approximate, failed, malformed and obsolete records, and bound each public/RT storage tier to roughly 1 MB, leaving quota headroom alongside ten site caches.
- Reconcile newer shared RT scores on site load without changing server-local IMDb/TMDB scores or their age; clear every ratings tier together and prevent late results from restoring cleared data.
- Include original titles in RT cache and pending-request keys so an earlier unsuccessful lookup cannot block an original-title rescue; prevent slow older lookups from overwriting newer refreshes and retry temporary persistence read failures.
- Add cross-site, localized-title, identity, provenance, freshness, failure, storage-bound and concurrency regressions, plus real Chromium restart/reuse/update/clear coverage.

## [3.5.72]

- Merge changes from multiple tabs on the same Seerr site instead of replacing the site's entire ratings cache and title index with each tab's snapshot.
- Preserve fresher ratings and updated title metadata when an older tab saves, and prevent unchanged old snapshots from restoring forgotten scores.
- Retry failed cache reads and recover from rejected writes after a missed cache-clear notification without restoring pre-clear ratings.
- Load persisted ratings in age order so a full in-memory cache evicts old entries before recent ones.
- Add concurrent-tab, clear-recovery, and reload-eviction regressions, plus a real Chromium worker/storage check with two independent cache clients.

## [3.5.71]

- Persist separate ratings and title indexes for up to ten Seerr sites, preserving each cache when switching sites or restarting the browser.
- Migrate the previous single-site cache automatically and isolate sites by server address, port, and base path.
- Bound each site's persisted data to roughly 600 KB, keeping recent ratings and list entries; serialize writes so sites do not overwrite each other.
- Count all site caches in Settings and clear them together with shared ratings when Clear ratings cache is used.
- Verify migration, multi-site isolation, storage budgets, clearing, concurrent writes, and two-site cache persistence across a real Chromium worker restart.

## [3.5.70]

- Keep the site being edited aligned with its URL and API key when another window changes the active site, including during initial loading and saving a renamed site.
- Refresh Settings' active-site label, action buttons, and permission notice across windows without discarding unsaved edits; identify new and removed site drafts in the selector.
- Save edits from an already-open single-site Settings window to the saved profiles after another window adds a second site, instead of silently writing retired fields.
- Stop in-flight title, watchlist, and season checks after switching away and back, requiring a fresh review before further API calls.
- Add Settings and worker race regressions, plus Chromium coverage for switching sites while another window has unsaved credentials.

## [3.5.69]

- Keep the popup's active-site selector and diagnostics synchronized with changes made in Settings, and discard delayed lists from older configurations.
- Use the confirmed switch result without a redundant read that could falsely restore the previous selection; expose the selected URL in the selector tooltip.
- Refresh history for the new site even when an earlier status lookup is pending.
- Restore the last loaded site selection when its replacement cannot be read, keeping the visible URL and API key aligned with the selected site.
- Prevent inactive nested Seerr installations from inheriting their parent site's overlay configuration, ratings cache access, or filter-preset access; add worker and browser regressions.

## [3.5.68]

- Save up to ten named Seerr sites with separate device-local API keys, preserving the original connection when another site is added.
- Switch the active site from the popup or Settings; edit saved connections and remove inactive sites without changing server data or confirmed history.
- Store URL/key pairs atomically, invalidate status caches on switching, and reject requests from stale reviews or inactive saved-site overlays.
- Show the request destination in external-site flyouts and refresh open integrations when connections change.
- Add two-site Chromium and Firefox fixture coverage plus regressions for migration, key isolation, failed storage, permission denial, and stale requests.

## [3.5.67]

- Remove cleared history from the popup immediately after deletion succeeds, even if reloading fails, and avoid status lookups for empty history.
- Distinguish approved requests, pending approval, monitoring, and blocklisted titles in recent-action status labels.
- Stop queued history status lookups and discard results when the server, API key, or settings generation changes.
- Preserve the popup logo, status dot, and spacing when long connection messages wrap on narrow screens; add worker and Chromium regressions.

## [3.5.66]

- Request host access before testing an unsaved Seerr connection, stop on denied permission or edited inputs, and clear the permission warning after a successful grant without saving settings.
- Keep API-key and Plex-token inputs full-sized and visibly focused when revealed, and give their Show/Hide buttons distinct accessible names.
- Correct the ratings-cache help to describe automatic background refresh and add browser regressions for credential visibility and testing unsaved settings.

## [3.5.65]

- Allow failed TV-season requests to be retried while continuing to block pending or approved requests and seasons already available.
- Refuse requests when season availability is malformed or contradictory, and prevent invalid episode counts from enabling a request.
- Add Select all requestable, Clear selection, and a live selection count to TV-season review, with keyboard focus preserved after each action.
- Add worker, Chromium, and Firefox regressions for retry behavior, malformed availability, bulk selection, and keyboard use; verify the picker on narrow screens.
- Give the Firefox smoke test an available BiDi port so an occupied debugging port cannot prevent verification.

## [3.5.64]

- Stop Seerr watchlist adds and season reviews when the server or API key changes during title verification or search.
- Stop Plex adds before the write if the account token changes or is removed during lookup; ignore old-account watchlist status replies.
- Preserve Unicode letters and meaningful non-Latin marks in Plex title matching and reject empty normalized titles, preventing unrelated titles from matching.
- Add deferred-response and title-matching regressions, including Japanese, Cyrillic and accented Latin titles.

## [3.5.62]

- Refuse media-request writes if the Seerr URL or API key changes during title matching or season validation.
- Add deferred-verification regressions proving no write reaches changed settings.

## [3.5.61]

- Skip null search results and candidates without valid TMDB IDs, and safely handle non-string release dates.
- Add regressions ensuring malformed candidates do not mask a valid title match.

## [3.5.60]

- Skip null and untyped request-history entries instead of aborting the lookup or treating unknown types as TV.
- Add regressions proving valid requests remain discoverable after malformed entries.

## [3.5.59]

- Exclude 4K entries from standard-quality request history matching so a pending 4K request cannot block a standard request.
- Add regressions for 4K-only history and mixed-quality entries.

## [3.5.58]

- Clear the previous diagnostic report when preparing a new one so failed refreshes cannot leave stale results visible.
- Add a preview-state regression covering successful preparation followed by a failed refresh.

## [3.5.57]

- Discard saved-match inspection results and errors that predate a successful deletion, preventing forgotten rows from reappearing.
- Add a deferred-inspection UI regression.

## [3.5.56]

- Prevent obsolete history refreshes from re-enabling controls while a clear operation is pending.
- Add a popup race regression covering refresh completion during clear and the final empty state.

## [3.5.55]

- Discard saved title-correction reads if the Seerr server changes while storage is pending, before querying candidates on the new server.
- Add a deferred-storage regression for server isolation.

## [3.5.54]

- Update the flyout year and media type after choosing a title match, instead of leaving stale metadata and appending a conflicting year to the heading.
- Add display regressions for a changed release year and an unknown year.

## [3.5.53]

- Prevent new status refreshes from resetting an active media request or season review.
- Preserve Retry status and refresh after request completion, with lifecycle regressions for both paths.

## [3.5.52]

- Invalidate earlier status lookups when a media request or season review begins so late results cannot reset the pending request UI.
- Add a deferred-response lifecycle regression.

## [3.5.51]

- Skip overlapping status refreshes while a Plex add is active so its pending label and disabled state cannot be reset by a stale watchlist read.
- Add a regression covering refresh during an add and the final success state.

## [3.5.50]

- Keep the Plex watchlist button disabled after successful or already-present adds instead of immediately allowing another click.
- Preserve retry behavior after failed adds, with three button-state regressions.

## [3.5.49]

- Ignore stale Plex configuration responses and failures before mutating the current connection state.
- Add race regressions verifying older disconnected results cannot override a newer connected state or its subsequent Plex rendering.

## [3.5.48]

- Refresh an expanded flyout when its extracted IMDb ID changes, even if the title and year remain the same.
- Add a lifecycle regression proving unchanged identities preserve the panel and newly discovered IDs replace stale action metadata.

## [3.5.47]

- Scan all links in IMDb hero metadata for the release year when the first link is a media type or content rating.
- Keep the scan scoped to the title metadata, with regressions for reordered links and missing years.

## [3.5.46]

- Restrict Filmweb extraction to film and series detail routes so discussion and episode-list headings cannot become request metadata.
- Reject unrelated routes after navigation while retaining encoded title slugs, trailing slashes and query parameters.
- Add seven route regressions.

## [3.5.45]

- Preserve numeric Filmweb titles in both original-title and localized-title extraction.
- Preserve TMDB subtitles following an en dash instead of truncating the title.
- Add four title-identity regressions while retaining parenthesized release-year cleanup.

## [3.5.44]

- Restrict IMDb extraction to exact title detail routes so review, credits and episode-list headings cannot become request metadata.
- Reject partial IMDb IDs and nested title paths, with seven route and fallback regressions.

## [3.5.43]

- Restrict Trakt extraction to movie, series and season detail routes; reject episode, comment and nested non-title routes before extracting request metadata.
- Add nine route regressions, preserving singular and plural routes used by the Trakt integrations.

## [3.5.42]

- Stop Rotten Tomatoes and Metacritic review subpages from producing requestable title metadata; reject RT episode subpages as well.
- Retain movie, series and season detail routes, with eight route regressions.

## [3.5.41]

- Restrict TMDB extraction to movie and series detail routes so cast, review and episode headings cannot become parent-title request metadata.
- Reject malformed, zero and unsafe TMDB route IDs while retaining slugs, trailing slashes and query parameters.
- Add nine route regressions.

## [3.5.40]

- Validate actual IMDb hosts and complete title IDs in the shared extractor.
- Validate Letterboxd TMDB movie links before accepting their IDs; reject lookalike domains, embedded URLs and partial numeric IDs.
- Add six external-link identity regressions.

## [3.5.39]

- Validate Trakt external TMDB links against the actual hostname, complete title path and current media type.
- Reject malformed, nonpositive and unsafe data-attribute IDs instead of truncating them to another title ID.
- Add identity regressions for opposite media types, lookalike hosts, embedded URLs and malformed IDs.

## [3.5.38]

- Read release years from selected time elements when their visible labels omit the year, preserving visible-year precedence and rejecting durations or implausible years.
- Add regressions across Trakt, Metacritic, Letterboxd, Rotten Tomatoes and TMDB.

## [3.5.37]

- Preserve numeric movie titles on IMDb, Letterboxd, Metacritic and Trakt while still removing parenthesized release-year labels.
- Add extraction and packaged-browser regressions for numeric titles across all four integrations.

## [3.5.36]

- Preserve Rotten Tomatoes movie titles containing four-digit numbers or the word Season; only remove explicit numbered season suffixes.
- Add regressions for 1917, Blade Runner 2049, Season of the Witch and The Seasoning House, including rendered extension panels.

## [3.5.35]

- Read Rotten Tomatoes release years from current hero metadata, including TV premiere ranges, without borrowing dates from related titles.
- Add metadata regression coverage and assert the TV year in Chromium, Firefox and live-site checks.
- Record consent controls and extracted years in blocked live-site diagnostics.

## [3.5.34]

- Keep delayed preset reads from overwriting newer cross-tab state, and ignore obsolete refresh errors.
- Stop late preset responses from updating controls after overlay cleanup.
- Restore the Saved presets placeholder when another tab deletes the selected preset.
- Add ordering/cleanup regressions and verify selected-preset deletion in the real two-tab browser test.

## [3.5.33]

- Reject stale Firefox manifests before signing, including same-version permission or identity changes.
- Verify the update-preparation CLI copies exact archive bytes and writes their SHA-256 into the feed using a synthetic packaging fixture.
- Document completion evidence for the revised five-part goal and retain explicit Mozilla-signing and publication gates.

## [3.5.32]

- Expand live-site coverage to TV, same-tab navigation, Spanish and Polish pages, redirects and small-window layouts; report blocked/unavailable sites separately.
- Correct the live Filmweb TV fixture identity and record nine passing live cases with three external access limitations.
- Prepare Firefox self-distribution manifests and hashed update feeds from signed artifacts; reject unsigned update inputs.
- Keep signing, publication and automatic-update verification as explicit external release gates.

## [3.5.31]

- Search saved title matches by original or selected title, server, year, type and TMDB ID.
- Show server labels and expandable individual match details without exposing credentials from malformed saved URLs.
- Keep filtering consistent after forgetting a match and return keyboard focus to search.
- Add unit and browser coverage for search, details, deletion and safe text rendering.

## [3.5.30]

- Pause notification dismissal while hovered or keyboard-focused, and keep errors visible until dismissed.
- Share notification behavior between site flyouts and the Seerr overlay, including accessible dismissal controls.
- Insert empty live regions before updating message text, and preserve focused notifications during bursts.
- Add browser checks for timing, persistent errors, dismissal and live-region initialization; VoiceOver verification remains separate.

## [3.5.29]

- Serialize preset saves and deletions in the worker so simultaneous tabs preserve each other’s changes.
- Synchronize open preset controls after storage changes and remove listeners when the overlay closes.
- Validate worker preset operations against the configured Seerr page and recover the write queue after storage failures.
- Add concurrent-tab browser coverage and worker regressions for ordered writes, deletion and failed storage.

## [3.5.28]

- Run popup diagnostics against a single settings snapshot and discard results when settings change during the check.
- Stop obsolete diagnostics before authentication and prevent mixed-server or mixed-credential reports.
- Add regressions for changes to the server, Seerr key, Plex token, settings reload, and in-flight authentication.

## [3.5.27]

- Keep external-site flyouts and notifications inside narrow or short windows, with scrollable content and wrapping long titles.
- Improve close-button contrast and sizing on dark host pages.
- Respect reduced-motion preferences for flyout and notification effects.
- Give injected request and watchlist buttons an explicit button type so they cannot submit a host-page form.
- Add browser regressions for 320-pixel layouts, keyboard access, reduced motion and accidental form submission.

## [3.5.25]

- Discard Seerr and Plex connection results when their tested settings have changed, and prompt a fresh test of the current values.
- Prevent older connection responses from overwriting newer status messages, while always restoring test controls.
- Guard repeated test calls and handle empty worker replies without exposing an internal error.

## [3.5.24]

- Re-evaluate missing rating fields after each Seerr response to skip redundant endpoints while still filling gaps.
- Treat sparse rating objects as incomplete and stop obsolete session lookups after reset or cancellation.
- Clear the IMDb threshold on navigation so a hidden old filter cannot suppress the new page’s titles.

## [3.5.23]

- Invalidate cached card identity, ratings, selection and Plex controls when a reused card links to a different title. Reject late rating results for the previous identity.
- Restore selected checkbox appearance and accessibility state after the host redraws its contents.
- Keep the bulk action toolbar within narrow screens and add visible keyboard focus to its controls.

## [3.5.22]

- Add bulk-selection controls to newly loaded cards, discard detached selections, and disable review when no cards are selected.
- Deduplicate repeated media identities before bulk review and requests.
- Restore the selection toggle, Plex controls and keyboard focus after bulk completion.

## [3.5.21]

- Move score details aside during bulk selection so the selection checkbox remains clickable.
- Report failed and partially failed bulk requests with the correct error or warning instead of a success notification, and announce results to assistive technology.
- Keep bulk review inside short, narrow viewports with wrapping controls and long titles, scrolling, and visible keyboard focus. Escape no longer propagates to the host page.

## [3.5.19]

- Stop Load more on navigation and page exit, without scrolling the new page or painting obsolete results.
- Prevent an abandoned run from resetting a newer run, restore controls on page exit, and show Loading immediately after starting.

## [3.5.18]

- Run manual grid refreshes through the four-job viewport queue, preserving release years and cancelling queued refreshes after navigation.
- Keep known scores visible during refresh and retain them when sources fail, instead of deleting fallback data before fetching.

## [3.5.17]

- Grant access from the Settings warning for the saved server, even when the URL field contains unsaved edits. Keep permission requests attached to the original click.
- Show cache read failures as unknown rather than empty, keep clearing available for recovery, and prevent duplicate clear requests with a visible pending state.

## [3.5.16]

- Keep saved filter presets unchanged in memory when saving or deleting fails. Disable preset controls during initial loading and writes to prevent overlapping operations.
- Clear the preset name after successful deletion and keep long names and storage feedback inside narrow toolbars.
- Add regression coverage for failed writes, delayed loading and narrow-screen preset controls.

## [3.5.15]

- Keep title and season dialogs inside narrow viewports regardless of host-page box sizing, wrap long titles, and improve action button contrast and sizing.
- Prevent older popup connection checks from overwriting newer results, and remove stale diagnostic details after a failed check.
- Add real-browser narrow-screen picker checks covering overflow, season selection and Escape focus restoration.

## [3.5.14]

- Match refreshed history statuses and links to stable action identities, and prevent delayed reads from restoring cleared history. Ignore invalid timestamps safely.
- Make saved-match inspection recover from connection failures with retry feedback.
- Give support tools a spaced, responsive Settings card and improve history controls, status/link separation and keyboard focus visibility.

## [3.5.13]

- Keep automatic refreshes of aging cached cards inside the same four-job viewport queue. Navigation cancels waiting refreshes as well as first-time lookups.

## [3.5.12]

- Prioritize visible card ratings with four concurrent jobs per page, reprioritize on scroll, and cancel obsolete queued/page-side reads after navigation.
- Add opt-in, device-local remembered title choices with fresh candidate validation and Settings inspection/reset.
- Recent actions retain resolved TMDB identities and server scope, refresh current status, and link directly to the correct Seerr title. Legacy/offline history remains readable.
- Add previewable, allowlisted diagnostic JSON exports without server addresses, credentials, titles or raw errors.
- Prepare Chrome/Firefox release archives with SHA-256 checksums, a manual artifact workflow, and credential-gated Firefox signing. Signed/store releases still require publisher access.

## [3.5.10]

- IMDb no longer treats unbranded error/challenge page titles as movies. Trakt ignores its generic application title and uses its existing route-title fallback. Both were found during live-site checks.
- Replaced nine suites of copied/simulated implementation logic with tests executing production migration, cache, extraction, summaries, debug controls, watchlist visibility, badges, and flyout lifecycle.
- Added an opt-in live-site smoke command that reports blocked sites separately from passing title extraction, without credentials or request writes.

## [3.5.9]

- Added real-extension Chromium and Firefox coverage for eleven synthetic movie/TV pages across all seven supported sites, including Polish Unicode titles. Fixtures verify production bootstrap and extraction, not current live-site markup.
- Added actual 3.5.2-to-current upgrade tests for saved preferences and legacy secret migration, with Chromium optional-permission and dynamic-script retention checks. CI retains the Git history needed for the old-version fixture.

## [3.5.8]

- Content-script ratings persistence now uses a validated worker bridge with origin/path/frame checks, bounded allowlisted data, and serialized cache clearing.
- Local storage is restricted to trusted extension contexts before startup where supported. Chromium rejects content-script secret reads; Firefox 147.0.3 uses the bridge but does not expose this access-control API.
- Safe worker notifications keep cache clearing and configuration changes working without exposing credentials through local-storage events. Legacy ratings verdict cleanup moved into the worker.

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

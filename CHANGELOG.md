# Changelog

All notable changes to the Super Seerr extension will be documented in this file.

Versions are produced by `make build`, which increments the patch number. Add
notes under the version a change actually ships in rather than inventing a new
heading per change.

## [3.5.259]

- Use Trakt's documented combined movie/show watchlist route. Correct the plural combined path introduced in 3.5.249 and verify movie/TV imports across two pages against a strict route fixture based on the provider's own contract.

## [3.5.258]

- Retire Trakt/Simkl imported titles and pending title actions immediately when the account identity changes or stored accounts are removed, even if reading the replacement connection state fails. Preserve unsaved Client ID edits and show a usable recovery action.
- Refresh tracker connections independently while another provider is authorizing. Keep cancellation available, resume each deferred account refresh when it can proceed, and reject metadata captured before a newer account action.
- Recheck account state when Settings returns from the browser's page cache, keeping old account controls unavailable until that check succeeds. Ordinary token rotations and sync timestamps continue to preserve current watchlist reads.

## [3.5.257]

- Restore keyboard focus after Settings saves, connection tests, cache clearing, reloads, and saved-site actions. Keep fallback controls visible when an action disappears or becomes unavailable, and respect focus moved elsewhere while work is pending.
- Preserve saved-site Retry focus in Settings and the popup when a newer cross-window refresh supersedes the original read, regardless of reply order or failure.
- Prevent duplicate Grant access requests and recover clearly when saved permission state cannot be read after a grant.

## [3.5.256]

- Save every Seerr URL/API-key pair atomically in local storage, including a single unnamed site, so slow or failed writes cannot attach one server's key to another URL. Keep legacy settings readable until explicitly saved, and distinguish a committed connection from later preference or refresh failures.
- Allow a corrected connection to replace an invalid legacy URL instead of letting the bad sync value block the repair.
- Preserve existing watchlist rows and keyboard focus while loading more Trakt/Simkl titles. Focus newly loaded titles after Sync or pagination, with usable fallbacks for empty lists, failed reads, and declined permissions.

## [3.5.255]

- Keep popup diagnostic messages tied to the live settings snapshot, rejecting old results when the active site, API key, Plex account, or settings generation changes during a check.
- Keep filter preset controls and keyboard focus owned by the newest operation, so delayed Save/Delete replies cannot unlock an unfinished refresh or another save.

## [3.5.254]

- Keep title and release-year evidence in Seerr status-cache keys so a reused or incorrect page-supplied ID cannot mix results between titles or remakes. Continue sharing underlying detail and request-history reads.
- Reject Plex connection-test responses without a valid account identity, including proxy HTML and unrelated JSON, and show a readable verified account name.
- Protect flyout keyboard controls from host-page shortcuts that cancel button activation or Tab navigation.
- Improve flyout text contrast across provider themes, light/dark watchlist controls, playback buttons, and library badges.
- Update the test tooling's transitive `source-map-js` and `undici` dependencies to patched versions; the dependency audit reports no known vulnerabilities.

## [3.5.253]

- Ignore scoreless persisted Seerr bundles so malformed multi-site cache records cannot consume the site cap or suppress a fresh lookup.

## [3.5.252]

- Apply sorting, filtering, reset, refresh coverage, and cache-age reporting to every rendered Seerr grid instead of only the first section on multi-grid pages.

## [3.5.251]

- Ignore structurally empty persisted Rotten Tomatoes cache records so malformed entries cannot suppress a fresh score lookup until expiry.

## [3.5.250]

- Treat cards hidden with `visibility: hidden` or `collapse` as hidden in filter coverage and sorting, so host layout state cannot inflate visible counts.

## [3.5.249]

- Changed Trakt's combined watchlist path to `movies,shows`; corrected in 3.5.259 after checking the provider's own route contract.

## [3.5.248]

- Deduplicate normalized multi-site ratings cache entries in Settings so migration-time duplicate server records cannot inflate the displayed cache count.

## [3.5.247]

- Use the newest standard Seerr request when embedded request relations arrive in an unspecified order, preventing stale declined or failed requests from masking a newer request state.

## [3.5.246]

- Merge duplicate normalized Seerr cache records per title during migration, preserving unique ratings and list entries while enforcing cache bounds.

## [3.5.245]

- Keep the freshest normalized server cache when legacy and per-server records use different trailing-slash keys.
- Sanitize shared public ratings before applying the bounded cache cap so malformed records cannot hide valid scores.

## [3.5.244]

- Keep link-backed Seerr cards visible to ratings, filters, and bulk selection when a list temporarily mixes them with `data-testid="title-card"` wrappers.

## [3.5.243]

- Ignore generic provider error documents on title-shaped routes so 404/5xx pages cannot become false requestable titles.

## [3.5.241]

- Add request flyouts on Simkl and JustWatch title pages, including localized JustWatch routes and explicitly typed Simkl anime. Reject access-challenge pages and unrelated recommendation metadata.
- Add Trakt and Simkl application setup, PKCE account connections, and manual read-only watchlist imports in Settings. Keep credentials device-local, bound imports, and reject stale account results.
- Add title exploration links, a saved JustWatch streaming region, and a copy-title action for Simkl search.
- Check localized and original titles before trusting a page-supplied TMDB ID, preventing a different title from being requested just because its release year matches.
- Correct Firefox's data-transmission disclosure for configured service credentials and title metadata, and cover newly added site permissions during upgrades.
- Normalize Chromium and Firefox Seerr network failures to the same actionable reconnect message.
- Release TV season-picker lifecycle state even when the picker rejects instead of completing normally.
- Collapse repeated trailing slashes when building Seerr API, diagnostics, history, and tracker search URLs, including legacy single-site settings.
- Add an explicit `noopener noreferrer` relationship to the Settings issue-report link.
- Capture the reviewed Seerr site token explicitly for watchlist writes, matching request and Plex actions during multi-site switches.
- Canonicalize numeric-string TMDB IDs across shared public ratings, server-scoped ratings, and the persisted title index so equivalent IDs cannot split caches.
- Reject zero, unsafe, and non-primitive TMDB IDs at the live and persisted catalogue-index boundaries so malformed records cannot hydrate or identify cards.
- Bound and cancel oversized Plex error responses before retaining a short diagnostic message.
- Reuse an empty Simkl watchlist when its valid null activity marker is unchanged, instead of downloading the feeds again on every manual sync.
- Bound successful Rotten Tomatoes HTML responses and cancel oversized pages before retaining them in the worker.
- Bound successful Seerr ratings/detail responses and cancel oversized JSON before parsing it in the page or worker.
- Bound successful public-settings responses used by diagnostics and media-server naming before parsing them in the worker.
- Bound and cancel oversized Seerr error responses before parsing them in the background worker, and release refused diagnostic/metadata responses promptly so proxy error pages cannot consume the worker indefinitely.

## [3.5.240]

- Keep narrow filter action buttons aligned and equally tall when labels wrap with different system fonts, fixing the 320px Linux CI layout failures.

## [3.5.239]

- Show saved-site capacity in Settings and prevent starting an eleventh site draft, while keeping existing sites editable and removable.

## [3.5.238]

- Count titles inside hidden grids and ancestor containers as hidden, while preserving host layout through Reset. Reuse ancestor visibility checks within each sort/count pass.

## [3.5.237]

- Refresh filter counts and reapply thresholds when Seerr changes card visibility or layout, without mutation-observer loops.

## [3.5.236]

- Make rating filters take precedence over important host layout rules, and calculate visibility from rendered styles when CSS overrides the hidden attribute.

## [3.5.235]

- Count and sort host-hidden titles consistently, including hidden list wrappers, HTML hidden attributes, and stylesheet display rules.

## [3.5.234]

- Preserve Seerr card and list-item display styles through rating filters, Reset, and overlay cleanup instead of erasing host layout or revealing host-hidden cards.

## [3.5.233]

- Apply strict release-year validation to provider ratings too, preventing malformed array years from publishing or reusing shared scores.

## [3.5.232]

- Reject array and object release years at the media boundary instead of coercing malformed identity data into request evidence.

## [3.5.231]

- Retire pending actions when same-page metadata replaces a collapsed title panel, so the replacement can load its own status.

## [3.5.230]

- Preserve an unremembered title-picker choice through same-page retries without carrying it across pages or Seerr sites.

## [3.5.229]

- Stop retired Rotten Tomatoes lookups between provider stages after a cache clear, including late replies and failures.

## [3.5.228]

- Preserve confirmed Plex watchlist state when its user-state lookup fails instead of treating the failure as a confirmed removal.

## [3.5.227]

- Keep pending Seerr watchlist controls visible when an earlier or concurrent status refresh completes.

## [3.5.226]

- Stop ratings work waiting for cache initialization when its page is retired by navigation, site changes, or a cache clear.

## [3.5.225]

- Report the actual active site when another Settings window switches sites before a pending activation finishes refreshing.
- Keep fictional parser fixtures out of the live-site smoke checks.

## [3.5.224]

- Preserve newer cross-tab preset messages, selection, and drafts when an older Save or Delete reply arrives late.

## [3.5.223]

- Align narrow-screen filter actions in one two-column grid, with a full-width final action when title selection is unavailable.

## [3.5.222]

- Refresh same-title flyout status in place so routine retries do not flash or replace the title panel.

## [3.5.221]

- Keep Trakt's title flyout and pending actions intact when changing only the selected TV season.

## [3.5.220]

- Align the sort and rating headings in the filter so wide layouts no longer leave an unexplained gap above sorting.
- Read Metacritic's current labeled release-date value so known release years remain available for title matching.

## [3.5.218]

- Keep the score explanation beside its rating filters and make the narrow-screen action row use its full width cleanly.

## [3.5.217]

- Retain Trakt release years when a visible title agrees with its slug, without mistaking a title such as "Space: 1999" for release metadata.

## [3.5.216]

- Keep Filmweb's original movie and TV titles separate from release-year metadata nested in the same heading.

## [3.5.215]

- Keep filter actions together across desktop and tablet widths, and balance narrow-screen action buttons so no control is stranded at full width.

## [3.5.214]

- Tear down site-specific Seerr overlays as soon as a site activation or server URL change starts, so late scores cannot repaint the previous site while configuration is loading.

## [3.5.213]

- Keep Reset, the score hint, and refresh/load actions grouped across desktop and narrow filter layouts, with consistent spacing when the hint wraps on mobile.

## [3.5.212]

- Align filter actions with their related sort and rating controls, and keep the hint beside the secondary actions as the panel narrows.
- Let valid shared Rotten Tomatoes scores fill missing fields in newer server-specific cache entries without replacing scores already stored by that site.
- Preserve confidence from the actual Rotten Tomatoes source contributing each field when cross-tab cache writes merge.

## [3.5.211]

- Bind search and diagnostic reads to the active Seerr connection so a site switch stops old lookups from continuing against the newly selected server.

## [3.5.210]

- Stop paged request-history status lookups immediately when the active Seerr site changes, so later pages cannot query a different saved server.

## [3.5.209]

- Align filter fields with the panel edges and use consistent spacing between sorting, rating thresholds, and actions.
- Keep preset actions together, align the preset selector and name at medium widths, and stack them cleanly on narrow screens.
- Retain active-rating highlights and consistent keyboard focus rings, with rendered spacing and action-group checks at seven widths from 320px to 1440px.

## [3.5.208]

- Clear an applied preset's selection when manual sorting, thresholds, or Reset diverge from it, allowing that preset to be selected again directly.
- Keep the preset-name draft available for saving and reconcile applied state when refreshed preset definitions change.
- Cover all four threshold edits, sorting, resetting, and complete preset reapplication in Chromium.

## [3.5.207]

- Isolate filter and toggle keyboard events from host-page shortcuts so typing, Tab navigation, and button activation continue working.
- Prevent Enter in a rating threshold from submitting a containing host search form, while retaining normal host controls outside the toolbar.
- Cover all four threshold fields, forward/backward navigation, form submission, Reset, and toggle activation in Chromium.

## [3.5.206]

- Apply typed decimal and exponent rating thresholds exactly rather than truncating critics/audience decimals or reading only an exponent's leading digits.
- Clamp typed thresholds to their displayed score scale, keeping the grid, active highlights, and saved presets consistent.
- Cover all four sources with decimal, exponent, oversized, and negative input in Chromium.

## [3.5.205]

- Tighten filter panel spacing and align sorting and rating inputs along the same baseline.
- Remove redundant threshold boxes and heading rows, constrain desktop preset widths, and group secondary actions away from Reset.
- Retain responsive stacking and active-score highlights, with rendered alignment and containment checks at seven widths from 320px to 1440px.

## [3.5.204]

- Redesign the filter panel with separate status, sorting, minimum-rating, action, and preset sections.
- Add larger controls, explicit score scales, clearer active thresholds, and a responsive two-column threshold grid that fixes narrow-screen overflow.
- Clarify the floating filter toggle and announce its expanded state; preserve thresholds when collapsing the panel.
- Verify desktop, tablet, and mobile layouts alongside filtering, resetting, sorting, and collapse/reopen behavior in Chromium.

## [3.5.203]

- Transfer preset loading-control ownership to the newest cross-tab read when it supersedes the initial load or a manual retry.
- Keep controls disabled while that read is pending and release them as soon as it finishes, without waiting for an obsolete reply.
- Preserve retry keyboard focus ownership and cover success, failure, and both reply orders in Chromium.

## [3.5.202]

- Prevent obsolete preset reads from replacing current presets or hiding recovery after a newer cross-tab refresh fails.
- Preserve the last confirmed preset list and unsaved name while keeping Retry loading presets available.
- Cover delayed initial and subsequent reads, newer success/failure outcomes, and successful retry in Chromium.

## [3.5.201]

- Preserve complementary IMDb and TMDB scores when separate tabs first discover the same title, including after a saved unrated result.
- Keep explicit native-score removals authoritative over delayed cold discoveries across worker restarts.
- Cover movie and TV discoveries, both write orders, persisted reloads, and removal boundaries.

## [3.5.200]

- Keep the popup connection-check button and label owned by the newest diagnostic check, including when switching Seerr sites during a manual check.
- Re-enable checking as soon as the latest reply arrives; obsolete replies cannot unlock a pending check or keep a completed check disabled.
- Move focus to Settings when refreshing removes a focused repair control, and cover both reply orders and obsolete success/failure responses in Chromium.

## [3.5.199]

- Hide obsolete connection readiness and diagnostic results immediately when the popup checks again or switches sites, rather than presenting a previous site's accepted API key while loading.
- Expose the current diagnostic busy state and preserve keyboard access when refreshing removes a focused repair button.
- Cover manual checks, site-change checks, focused repairs, and successful or failed completion in Chromium.

## [3.5.198]

- Preserve keyboard focus ownership when a site-change refresh removes a focused history link, returning to Refresh statuses when the latest refresh finishes.
- Carry ownership across superseding refreshes, discard it when another control receives focus, and prevent obsolete replies from moving focus.
- Cover successful and failed site-change refreshes, overlapping replies, and deliberately moved focus in Chromium.

## [3.5.197]

- Remove previous history statuses and links immediately when a refresh begins, including after switching Seerr sites; confirmed action records remain visible if the read fails.
- Announce history loading and expose its busy state until the current refresh or clear completes.
- Cover failed replies and rejected reads, manual and site-change refreshes, preserved historical destinations, and successful retry in Chromium.

## [3.5.196]

- Restore keyboard focus after popup history refresh and clear operations when the initiating control still owns focus.
- Move focus to Refresh statuses after confirmed clearing leaves Clear history disabled, while preserving focus moved elsewhere during an operation.
- Cover successful and failed refreshes and clears, each with retained or moved focus, in Chromium.

## [3.5.195]

- Recognize equivalent relative, absolute, protocol-relative, and default-port Rotten Tomatoes links as one provider page when checking search ambiguity.
- Continue refusing equally strong matches on genuinely different pages.
- Cover movie and TV search HTML, both result orders, single detail reads, and verified public-cache reuse on a second Seerr site after restart.

## [3.5.194]

- Bound persisted Rotten Tomatoes title-cache expiry by its recorded check time and the scored, negative, or failure TTL.
- Recheck expired verdicts even when stored expiry is inflated, while retaining fresh records and their original check times.
- Cover scored, unrated, uncertain, and failed entries, provider request counts, and corrected expiry after persistence.

## [3.5.193]

- Prevent an older pending saved-match write from restoring a forgotten choice or overwriting a newer confirmed choice after delayed candidate validation.
- Scope cancellation to older changes for the same match; unrelated saves, newer pending choices, and failed-change recovery remain available.
- Cover movie and TV save races, persistence after restart, both completion orders, unrelated matches, and failed mutations.

## [3.5.192]

- Discard pending remembered-title lookups when a saved match is forgotten or replaced, so a confirmed change cannot be undone by an older storage or candidate reply.
- Invalidate only after successful persistence; failed changes retain the existing saved choice.
- Cover movie and TV lookups during both read phases, replacement recovery, and failed-mutation controls.

## [3.5.191]

- Disable Seerr and Plex connection-test buttons while a saved site's fields are loading, preventing tests against the previous draft.
- Track pending tests separately so their completion cannot prematurely unlock buttons during a site read, and metadata refreshes cannot unlock a running test.
- Cover successful and failed site reads, zero test messages while loading, and delayed test completion in the browser.

## [3.5.190]

- Replace previous connection-test feedback as soon as a different saved site starts loading in Settings, then confirm when its fields are ready.
- Invalidate pending test messages so old success or failure replies cannot describe the newly selected site's settings.
- Cover both reply outcomes arriving during and after a delayed site read.

## [3.5.189]

- Skip empty or malformed entries in ungrouped Plex search results so one null record cannot prevent an otherwise verified movie or TV addition.
- Report the usual no-match error when no usable candidate remains, without issuing a write.
- Cover null entries before and after valid matches, all-null responses, and grouped-response controls through the complete add flow.

## [3.5.188]

- Require a complete string TMDB GUID with a positive safe integer when verifying Plex search candidates, instead of accepting a numeric prefix or coerced array.
- Skip malformed candidates and continue checking later results, while refusing additions when no verified match remains.
- Cover movie and TV additions with suffixes, paths, queries, fragments, line breaks, and array GUIDs; verify both safe fallback and zero-write refusal.

## [3.5.187]

- Normalize Plex candidate release years consistently across grouped and ungrouped search responses, including numeric strings and release dates.
- Require year confirmation for title-only lookups with a known release year, preventing missing or malformed candidate years from selecting a different remake.
- Cover movie and TV additions with matching, mismatched, missing, and malformed years in both response formats; rejected matches issue no write.

## [3.5.186]

- Keep Plex action history attributed to the Seerr site active when the action starts, even if the user switches sites before it finishes.
- Preserve absent site attribution and ignore caller-supplied history URLs for Plex additions.
- Cover pending site switches, unchanged settings, persisted history after restart, and caller attribution overrides.

## [3.5.185]

- Offer a read-only Retry loading presets action after initial or cross-tab load failures, without requiring users to save a preset to recover existing choices.
- Preserve typed preset names and focus ownership across reloads, and hide recovery controls when newer data arrives successfully.
- Cover successful and failed retries, no storage writes, narrow layout, and obsolete retry failures after a newer cross-tab refresh.

## [3.5.184]

- Save a named filter preset with Enter and prevent the key from submitting an enclosing host-page form.
- Leave Enter used for IME text composition alone, and restore focus to the name field after success or failure without changing existing button focus behavior.
- Cover keyboard saves both inside and outside a form, successful and failed saves, composition, and host-form submission prevention in the browser.

## [3.5.183]

- Prevent a delayed initial Plex status reply from replacing the retry button after a newer detail-page add attempt fails.
- Continue showing initial watchlist state when no add was attempted.
- Cover failed responses and rejected channels in DOM and browser retry tests, with an unchanged initial-state control; both failure cases reproduced before the fix.

## [3.5.182]

- Use persistent, announced, dismissible error notifications for failed detail-page Plex additions, matching the card action instead of removing plain-text feedback after five seconds.
- Preserve keyboard focus restoration and retry after rejected responses or connection failures, while continuing to ignore obsolete replies after navigation.
- Add browser regressions for error persistence, safe text rendering, keyboard dismissal, and successful retry; both failure modes reproduced before the fix.

## [3.5.181]

- Split a detail heading's trailing release year before Plex Watchlist status checks and add actions, so title fallback matching receives the title and year separately.
- Preserve meaningful title numbers such as Blade Runner 2049.
- Add movie and TV detail regressions for both heading formats and both Plex messages; all four failed before the fix.

## [3.5.180]

- Keep Seerr notifications within narrow viewports, including padding, and wrap long titles and error text.
- Bound the error stack to the screen so every dismiss control remains reachable with keyboard focus and users can scroll through longer results.
- Add real-browser checks for 320/375-pixel layouts, focus restoration, and stacked errors on a short screen; the narrow overflow and off-screen dismissal cases failed before the fix.

## [3.5.179]

- Apply known catalogue years before the ratings cache fast path, preventing callers without a visible year from reconciling a shared public score for a contradictory remake.
- Preserve native server scores while rejecting mismatched public ratings.
- Extend movie and TV shared-cache regressions with yearless callers; both mismatched-year cases failed before the fix and matching-year controls still pass.

## [3.5.178]

- Merge a delayed stored catalogue into live observations field by field, retaining cached posters and years when current records omit them while keeping newer live values.
- Apply catalogue retention with cached records first so older cached-only titles cannot evict live observations.
- Cover delayed reads with missing and updated live years, poster-only card hydration, and catalogue retention; both reported failure cases reproduced before the fix.

## [3.5.177]

- Compare catalogue updates with each tab's previous snapshot, so changing a poster cannot replay an unchanged stale title, year, or date over another tab's correction.
- Keep deliberate later corrections writable and retain compatibility with older clients that omit catalogue snapshots.
- Add movie and TV concurrency regressions in both write orders, including a later correction from the stale tab; all four failed before the fix.

## [3.5.176]

- Preserve complementary title, original-title, poster, release-date, and year metadata when tabs write partial catalogue updates to the same server's cache.
- Continue accepting explicit metadata corrections instead of treating known fields as immutable.
- Add movie and TV concurrency regressions for both write orders, worker restart, and later corrections; all four failed before the fix.

## [3.5.175]

- Validate catalogue release years using the worker's date format instead of coercing arrays, numeric dates, or partial strings into identity evidence.
- Treat numeric years outside 1800–9999 as unknown, including when restoring a server's saved title index, while retaining valid catalogue years and date strings.
- Add ten bulk-flow regressions covering malformed metadata and valid-year controls; eight failed before the fix.

## [3.5.174]

- Preserve the selected card's catalogue release year in bulk season reviews and requests, allowing the worker's existing same-name remake checks to use that evidence.
- Add movie and TV regressions using actual catalogue hydration and bulk controls; both failed before the fix because the year was omitted.

## [3.5.173]

- Keep bulk failure results visible until dismissed, including partial failures, and list each failed title with its reported reason or a useful fallback.
- Bound the failure panel to small screens and allow keyboard scrolling without rendering titles or error text as markup.
- Cover mixed success, rejected requests, transport failures, missing error details, persistence, and narrow-screen layout in the browser.

## [3.5.172]

- Create bulk-result notifications after selection cleanup and focus restoration, so keyboard dismissal returns to a surviving control rather than dropping focus onto the page.
- Preserve return to an unrelated control when the user moved focus during requests.
- Extend success/failure browser regressions to dismiss each completion notification and verify its focus destination.

## [3.5.171]

- Preserve focus on unrelated page controls when delayed bulk requests finish successfully or fail.
- Restore the selection control when the dialog owns focus, or when completion removes the focused card-selection control.
- Add browser regressions for success/failure with focus inside the dialog, elsewhere on the page, and on a control removed during cleanup.

## [3.5.170]

- Keep title-match explanations and bulk-review summaries visible on opening by focusing their headings instead of their footer Cancel buttons.
- Preserve keyboard entry into dialog controls, Escape cancellation and focus return; correct singular ready/excluded title counts.
- Add narrow-screen regressions for empty/single/long candidate lists and a 21-title bulk review, with before/after render inspection.

## [3.5.169]

- Open TV season review at its title and instructions instead of scrolling to the Cancel button at the bottom of long lists.
- Focus the heading without scrolling while retaining keyboard entry into enabled controls, Escape cancellation and return to the opener.
- Add narrow-viewport browser regressions for short/long lists with and without requestable seasons; inspect before/after renders.

## [3.5.168]

- Skip redundant ratings/catalogue storage writes when the bounded merged cache already matches the persisted record.
- Keep server and clear-epoch validation for unchanged flushes, and still retire legacy cache payloads when migration is needed.
- Add write-count, actual-update, legacy-retirement and missed-clear regressions.

## [3.5.167]

- Exclude worker-owned native removal clocks from cache-deletion snapshot comparisons, allowing the originating tab to forget an otherwise unchanged entry without reloading.
- Keep score, timestamp, retry and diagnostic comparisons intact so stale tabs still cannot delete changed ratings.
- Add IMDb/TMDB deletion regressions for original and reloaded tabs.

## [3.5.166]

- Merge complementary IMDb/TMDB discoveries from overlapping tabs instead of letting an unchanged missing field erase the other tab's score.
- Preserve explicit native removals across worker restarts so delayed discoveries cannot resurrect them; update diagnostics when merged ratings become complete.
- Add movie/TV concurrency and reload regressions for both write orders, plus explicit-removal controls.

## [3.5.165]

- Protect settings fields during the initial storage read and bind submit handling before that read, preventing lost edits and native form navigation during startup.
- Restore controls after successful or failed initial reads; continue cache-count setup and popup repair focus when permission-state reads fail.
- Add delayed-startup success/failure and permission-read regressions, including narrow-layout Chromium checks.

## [3.5.164]

- Disable settings inputs while a saved-site selection, activation, or removal loads replacement values, preventing delayed reads from erasing newly typed edits.
- Restore each input's prior enabled state after success or failure, announce the busy form, and disable Save while an operation is pending.
- Keep newer drafts editable during saves; cover delayed reads and recovery in settings and browser regressions.

## [3.5.163]

- Include prior entry snapshots in cache deltas so same-millisecond public reconciliations can be distinguished from native rating updates.
- Preserve another tab's refreshed IMDb/TMDB scores and retry timing when a public-only update carries an older native snapshot.
- Add both-write-order concurrency and reload regressions, plus a control for genuine combined native/public refreshes.

## [3.5.162]

- Require decimal native score strings, preventing missing percentages and hexadecimal/binary/exponent notation from becoming confident ratings.
- Accept percentage suffixes only on Rotten Tomatoes scores while preserving real 0%, decimal rounding and valid scores from partially malformed responses.
- Advance the matcher revision to recheck old verdicts; add movie/TV cache persistence and reload regressions.

## [3.5.161]

- Cancel unread failed Seerr session-response bodies before completing rating jobs, preventing error-page downloads from continuing after a grid lookup finishes.
- Preserve HTTP status and cache absence/failure semantics even when stream cancellation rejects.
- Add concurrent movie/TV response-cleanup regressions and a local streaming HTTP test that verifies the connection closes.

## [3.5.160]

- Validate download progress before rendering it, accepting bounded numeric percentages and avoiding object text, duplicate percent suffixes and impossible values.
- Read valid progress from nested media records and prevent invalid aliases from erasing an existing percentage.
- Normalize season availability enums and exclude unknown/malformed records from incomplete-season hints; add worker and browser regressions.

## [3.5.159]

- Preserve the primary flyout status when supplementary title information is present, so declined, failed and processing messages remain visible.
- Describe production, collection and season metadata without claiming Seerr is monitoring future content.
- Add worker and narrow-browser regressions using actual formatted status responses.

## [3.5.158]

- Distinguish missing API keys from saved keys that are rejected or could not be verified, avoiding misleading ratings-only status and instructions to add an existing key.
- Report saved-but-unverified keys as needing attention and direct users to the API key check while preserving connection and permission warnings.
- Add credential-presence and popup regressions; exercise authentication failure and recovery in the installed extension without exposing credentials.

## [3.5.157]

- Include the Seerr installation path alongside its host and port in the popup connection summary, with the full URL available as a tooltip.
- Label confirmed Seerr history entries with their historical destination so identical titles requested on different sites remain distinguishable.
- Keep Plex and legacy history labels accurate; add browser coverage for shared-host installations and long destination URLs in a narrow popup.

## [3.5.156]

- Refuse equally strong Rotten Tomatoes matches to distinct provider entries even when their localized/original titles differ, preventing search order from choosing a score to share across sites.
- Preserve stronger matches, original-title rescue and duplicate rows for the same provider URL.
- Advance the matcher revision to recheck old cached verdicts; add movie/TV result-order and approximate-match ambiguity regressions.

## [3.5.155]

- Restore lookup ordering from persisted title-only, unrated and failed Rotten Tomatoes results, preventing worker restarts from silently discarding successful refreshes.
- Reject nonfinite or malformed cache timestamps and implausibly distant future check times before they can pin stale results or the lookup clock.
- Add restart regressions that verify refreshed scores persist and become available across Seerr sites, plus invalid-timestamp recovery coverage.

## [3.5.154]

- Require a complete release-date format or a four-digit year before using Seerr metadata as title-identity evidence; do not coerce malformed detail dates into contradictory years.
- Combine equivalent numeric TMDB IDs in search results, preventing duplicate title choices and false ambiguity.
- Add movie/TV regressions for malformed-date write safety, detail identity checks, valid release dates and distinct-title ambiguity.

## [3.5.153]

- Treat a conflicting release year as evidence against a page-supplied TMDB ID even when a remake has the same title, triggering a fresh match before status lookups or writes.
- Preserve localized-title handling and the one-year release-date tolerance; require another season review if a TV request resolves to a different identity.
- Add movie/TV request, watchlist, status, season-review and unmatched-remake regressions.

## [3.5.152]

- Report successful site activation/removal separately from a failed Settings reload, preserving the error instead of replacing it with a success message.
- Preserve the previous draft identity when a legacy site-selection fallback cannot load settings.
- Add regressions covering committed changes, preserved drafts, disabled stale actions and preventing duplicate mutations after refresh failures.

## [3.5.151]

- Conceal a revealed Seerr API key before a settings reload replaces its site or credential, preventing site removal from revealing the active site's key.
- Conceal changed Plex tokens on reload while preserving the user's reveal choice for unchanged credentials.
- Add browser regressions for saved-site removal and changed versus unchanged Seerr/Plex credentials.

## [3.5.150]

- Reject contradictory or malformed title IDs in Seerr detail responses before using their scores; retain valid ratings from other endpoints and retry incomplete lookups.
- Advance the cache revision so previously saved bundles are rechecked under the identity guard.
- Add movie/TV regressions for mismatched IDs, valid numeric-string IDs, partial results and preventing wrong-title score persistence.

## [3.5.149]

- Reload saved Rotten Tomatoes and shared public ratings before persistence, preventing a temporary read failure from replacing both tiers with a partial cache.
- Skip writes while storage remains unreadable or a cache clear owns storage, preserving saved ratings and avoiding a clear/write dependency cycle.
- Add recovery and worker-restart regressions for both persisted tiers, plus concurrent clear/flush coverage.

## [3.5.148]

- Label missing or uncertain season episode counts as unavailable instead of displaying zero or undefined episodes, and use singular wording for one episode.
- Add a browser regression checking visible checkbox labels and confirming bulk selection still excludes seasons that cannot be requested.

## [3.5.147]

- Refuse season requests when duplicate metadata reports contradictory episode counts, instead of allowing the final duplicate to decide whether a season is requestable.
- Show uncertain season information without presenting a disputed count as confirmed; retain known availability and pending-request labels.
- Add order-independent conflict, repeated-conflict, identical-duplicate and confirmed-availability regressions.

## [3.5.146]

- Return the title's TMDB ID and nested media title when formatting request-history status, instead of labeling Seerr request or media row IDs as title IDs.
- Preserve the resolved TMDB identity in status responses for both known-ID and title-search lookups, including titles not yet requested.
- Add movie/TV history, unrequested-title and formatter regressions for identity preservation.

## [3.5.145]

- Preserve keyboard focus through saved-site recovery in the popup and Settings, moving focus to the site selector after success while respecting focus moved elsewhere during loading.
- Keep failed retries focused and use the Settings link when popup recovery finds no saved sites.
- Hide the empty popup site switcher when no profiles are saved; its hidden class previously had no matching CSS rule.
- Add real-browser coverage for success and failure on both pages, including users moving focus during a pending retry.

## [3.5.144]

- Compare the full saved rating snapshot before deleting it from a site's cache, protecting concurrent score, retry and diagnostic changes even when timestamps are unchanged.
- Canonicalize deletion snapshots through the storage bridge so valid deletions still work after null fields and bounded values have been normalized.
- Add two-tab regressions for same-time score updates and failed-refresh backoff, including deletion of the matching current snapshot.

## [3.5.143]

- Restore keyboard focus when dismissing request and connection notifications, with another notification as a fallback when the initiating control is gone.
- Isolate notification keystrokes from host shortcuts and prevent fading notifications from accepting focus.
- Add browser coverage for dismissal with and without reduced motion, removed controls, background removal and host shortcuts.

## [3.5.142]

- Mark the ratings-toolbar buttons as non-submit actions, preventing Reset, Refresh, Load more and Select titles from submitting a containing host form.
- Associate each score-filter label with its numeric input, enabling label clicks and accessible names for all four thresholds.
- Add browser regressions for unintended form submission and label interaction on critics, audience, TMDB and IMDb filters.

## [3.5.141]

- Measure each queued card once per dispatch pass when prioritizing ratings, instead of repeatedly reading layout inside the sort comparator.
- Skip layout work while every queue slot is occupied; recalculate priorities when work can start so scrolling and moved cards remain respected.
- Add a large-grid layout-read budget regression and a changing-position check alongside existing cancellation and concurrency coverage.

## [3.5.140]

- Verify that freshly fetched season details identify the intended TV title before presenting availability or approving a season request.
- Reject missing, malformed and contradictory IDs with an actionable retry message; retain support for valid numeric-string IDs.
- Add regressions proving invalid detail identities cannot authorize writes, plus valid identity and settings-race coverage.

## [3.5.139]

- Reset and repaint the full overlay when a cache write reveals a missed clear, instead of clearing memory while leaving old scores visible.
- Share the normal clear recovery path between rejected writes and changed read epochs.
- Add a DOM regression proving displayed ratings refresh and the next write uses the new epoch and fresh scores.

## [3.5.138]

- Require actual string title fields when validating Seerr search candidates, so arrays, numbers and booleans cannot authorize a media request through string coercion.
- Keep valid original-title matching available when a display title is malformed, and use a valid title string in the ambiguity picker.
- Add regressions for all four candidate title fields, numeric/boolean titles, blocked writes and valid original-title recovery.

## [3.5.137]

- Preserve keyboard focus after preset saves and failed deletions; move focus to the preset selector after successful deletion without taking focus moved elsewhere.
- Keep host-page keydown shortcuts from blocking preset-name typing and Tab navigation within the preset controls.
- Add browser checks for save/delete success and failure, moved focus and host keyboard interference.

## [3.5.136]

- Keep host-page keydown shortcuts from cancelling score-details keyboard opening, closing and Tab navigation.
- Restore keyboard focus to Retry scores after refresh and repaint, preserving focus moved elsewhere. Ignore completion updates for removed details or a different route.
- Add browser regressions for host shortcut isolation and focus ownership after successful and failed score retries.

## [3.5.135]

- Detect cache clears missed by an open tab when its next public-ratings read returns a different cache epoch, even if no shared scores remain.
- Reset the tab's ratings and catalogue state through the normal clear path and repaint from fresh lookups instead of retaining pre-clear scores.
- Add worker-backed cache and actual-overlay DOM regressions for missed notifications and successful recovery.

## [3.5.134]

- Escape title-cache field delimiters and use structured keys for concurrent RT lookups, so colons and literal percent sequences cannot mix different titles or original titles.
- Require typed movie/TV identities and numeric or string TMDB IDs before sharing or reading verified public ratings; reject array coercion.
- Invalidate older ratings verdicts that may have been affected, retaining each site's catalogue index. Add regression checks for live and persisted cache collisions, concurrent lookups and malformed shared identities.

## [3.5.133]

- Prevent late Plex Watchlist results from changing stale card or detail controls, showing old-title notifications, or adding errors after navigation or a Seerr site switch.
- Revalidate recycled card identities before starting actions and accepting replies; preserve normal success and retry behavior for the current title.
- Add regressions covering successful, failed and rejected Plex adds during card reuse, navigation and active-site changes.

## [3.5.132]

- Restore focus to Choose seasons after nested bulk TV season review, without taking focus moved to another control or a different route.
- Keep bulk-review keydown events from reaching host shortcuts and cancelling its keyboard navigation.
- Add browser checks for cancelled and confirmed season selection, availability failures, moved focus and host shortcut isolation; verify these reviews send no requests.

## [3.5.131]

- Serialize content-script registration updates so overlapping settings and permission changes cannot cause duplicate-ID failures; keep queued updates aligned with the latest site.
- Avoid reading a missing remembered server name during unconfigured worker startup.
- Keep title and season picker keydown events from reaching host-page shortcut handlers, preserving Tab navigation, checkbox selection and Enter confirmation.
- Add Chromium checks against a host handler that cancels keyboard defaults, and confirm host shortcuts resume after the picker closes.

## [3.5.130]

- Decode decimal and hexadecimal provider character references using full Unicode code points, preserving supplementary characters in matched titles.
- Decode references once so escaped entity text cannot become a false exact match; replace invalid Unicode scalar values safely.
- Invalidate older matching verdicts and add verified-sharing and false-match regressions.

## [3.5.129]

- Reject malformed Rotten Tomatoes percentages such as arrays, hexadecimal and exponent strings before they can become shared scores.
- Keep numeric scores, ordinary decimal percentages and real zero supported; handle surrounding percentage whitespace consistently.
- Invalidate older score verdicts and add shared-cache rejection and valid-format regressions.

## [3.5.128]

- Remove only the forgotten saved-match row, preserving other open match details and their keyboard focus.
- Restore focus to search after removal or to the retry button after failure only when the pending action still owns focus.
- Add Chromium checks for normal completion, moved focus, open neighboring details and failure recovery.

## [3.5.127]

- Keep pending Forget match actions disabled across filtering and saved-match list refreshes, preventing duplicate removal requests.
- Re-enable the currently displayed control after a failed removal so users can retry without reloading Settings.

## [3.5.126]

- Restore keyboard focus to the popup's site selector after a successful or failed switch, including any queued list refresh.
- Preserve focus moved to another control while switching; add browser regressions and verify focus in the installed multi-site flow.

## [3.5.125]

- Cancel unread Rotten Tomatoes HTTP error bodies before releasing their request slot, avoiding background downloads from refused pages.
- Preserve the original HTTP status and page path even if stream cancellation fails; verify queued refusals release all slots.

## [3.5.124]

- Hold Rotten Tomatoes concurrency slots through response-body downloads, preventing slow pages from exceeding the shared three-request limit.
- Verify that successful and interrupted body reads release slots and allow all queued lookups to finish.

## [3.5.123]

- Treat missing Rotten Tomatoes scorecards as failed detail reads, including empty, consent, truncated and unrelated-script pages.
- Keep these attempts out of the shared ratings cache, retry them sooner and preserve complete successful fallback scores during refresh failures.
- Invalidate ratings cached under the previous verification rules and add cross-site recovery and fallback regressions.

## [3.5.122]

- Validate TMDB IDs in request history before matching them to a title, preventing arrays, booleans and non-decimal strings from attaching an unrelated status or playback link.
- Keep valid numeric and decimal-string IDs supported and prevent malformed entries from masking a later valid request.

## [3.5.121]

- Treat missing or malformed Seerr search results as retryable lookup failures instead of telling users there is no matching title.
- Ignore stray invalid search rows so valid candidates can still be selected and requested.
- Add regressions for immediate recovery, invalid-response write prevention and valid empty searches.

## [3.5.120]

- Preserve focus moved outside a title or season picker when navigation or a site change cancels it.
- Continue restoring the initiating control when focus remains in the picker; add Chromium regressions for both cancellation paths.

## [3.5.119]

- Preserve meaningful non-Latin marks when matching Seerr titles and public ratings, preventing distinct Japanese, Cyrillic, Indic and Arabic titles from becoming exact matches.
- Retain Latin accent folding and canonical Unicode equivalence; reject mark-only text as a title identity.
- Invalidate scores cached under the previous matching rules and add request-safety and shared-rating regressions.

## [3.5.118]

- Keep Choose TV seasons hidden and disabled until a known title status is available, including during loading, errors, ambiguous matches and blocklisting.
- Preserve season selection for known pending, processing, partial and available titles so users can request other eligible seasons.
- Add state-transition regressions and a narrow Chromium flyout check; keep existing layout tests grounded in a loaded status.

## [3.5.117]

- Restore focus to the initiating control when a TV season picker is cancelled after the loading state disabled the Request button.
- Restore only when focus was left on the page and the opener remains connected and enabled; preserve focus moved elsewhere.
- Add no-write and focus-ownership regressions, including full Chromium request flows cancelled with Cancel and Escape.

## [3.5.116]

- Save credentials, feature switches and debug logging from one form snapshot, avoiding mixed values when permissions or site persistence are pending.
- Preserve later edits and explain that they remain unsaved instead of displaying an unconditional save-success message.
- Add legacy/profile permission-delay regressions and a Chromium interaction check for edits during a pending site write.

## [3.5.115]

- Let a failed popup saved-site list recover through an inline Retry saved sites button, with focus restored to the selector after recovery.
- Disable site switching during list refreshes and keep stale replies from enabling controls while a newer refresh is pending.
- Add malformed/missing/rejected reply recovery, stale-selector guards and a narrow Chromium layout/focus check.

## [3.5.114]

- Retry uncertain matches with no usable scores after their shorter deadline instead of suppressing lookups for the six-hour confirmed-unrated interval.
- Preserve null-bundle retry metadata across reloads and honor earlier retry deadlines while retaining existing provisional and confirmed-unrated limits.
- Add same-tab and reload regressions for current, earlier and legacy uncertain deadlines, plus fresh-cache metadata preservation.

## [3.5.113]

- Refresh open-popup history statuses after the worker confirms credential and permission changes, preventing obsolete availability labels after an API key is replaced or cleared.
- Use the worker's configuration-ready signal for history and remove the redundant site-selector event, retaining stale-response and pending-clear guards.
- Verify notification handling, ignored ratings messages and clear ordering; extend installed Chromium coverage through key-save and key-clear history recovery.

## [3.5.112]

- Preserve the pending Settings site selection across background site-list refreshes, keeping the selector aligned with the credentials loaded into the form.
- Disable Use/Remove while saved-site metadata refreshes and block corresponding actions until the newest refresh settles.
- Add pending-selection success/failure and loading-state regressions plus a narrow Chromium form interaction check.

## [3.5.111]

- Stop old-connection status lookups before starting dependent detail reads or additional title-search variants after a server, key or saved-site revision changes.
- Reject identity verification interrupted by a connection change instead of treating it as an ordinary unavailable lookup; guard request-history and detail continuations too.
- Reuse a shared connection guard and add 13 regressions reproduced against the previous implementation.

## [3.5.110]

- Bind cached server reads and status lookups to their original server, API key and saved-site revision, rejecting queued or in-flight results after a connection change.
- Prevent deferred reads from starting with a newly active site's credentials; retain normal request coalescing and write invalidation.
- Add queued/in-flight server, credential, revision and stale-status regressions.

## [3.5.109]

- Validate account replies consistently in Settings connection tests and popup diagnostics, rejecting malformed successful responses.
- Discard saved-site connection test results when the server, credentials or settings generation changes during authentication.
- Show a readable account fallback when Seerr omits a display name; add malformed-account and connection-change regressions.

## [3.5.108]

- Refresh open popup diagnostics after credential reloads and host-permission changes instead of retaining obsolete key, Plex or permission results.
- Send a credential-free worker notification after settings and registration are ready; keep public-rating and cache-clear notifications separate from connection checks.
- Retain diagnostic generation guards and add reload-ordering, permission, absent-popup and installed-browser automatic recovery regressions.

## [3.5.107]

- Validate public settings before reporting Seerr as reachable, rejecting successful HTML/proxy responses and unrelated JSON; distinguish incomplete initial setup from a ready server.
- Verify the account response contains a valid user ID before marking an API key accepted, while retaining authenticated fallback when the public endpoint is blocked.
- Keep the popup check button label consistent and preserve its icon across repeated checks; add malformed-response, setup, authentication and installed-browser recovery regressions.

## [3.5.106]

- Preserve Score details expansion and keyboard focus when ratings repaint after a refresh or shared public update, on cards and detail pages.
- Restore focus only for the same title and only when the user has not moved to another control; discard saved view state on navigation, cleanup and card identity changes.
- Add open/closed, summary/retry focus and intervening-focus DOM regressions plus installed Chromium shared-update coverage.

## [3.5.105]

- Show an inline saved-sites error for failed, missing or malformed worker replies instead of silently retaining apparently current controls.
- Pause switching and removal until the site list refreshes successfully, with an in-place Retry saved sites action that preserves the selected profile and unsaved fields.
- Keep obsolete replies from overriding newer recovery state; add failure/recovery, ordering and narrow-layout browser regressions.

## [3.5.104]

- Cap adopted public ratings at their original provider expiry instead of retaining a later server-cache retry deadline.
- Preserve earlier native retries and apply the same expiry rule when concurrent tabs merge public and server-specific scores; keep failed-read backoff for already expired fallbacks.
- Add expiry, background refresh, persistence and both-order concurrent merge regressions without renewing native score age.

## [3.5.103]

- Update Score details when verified shared ratings resolve an uncertain match or fill missing scores, so the explanation agrees with the displayed ratings.
- Preserve genuine lookup-failure notices and unresolved match explanations; correct older persisted explanations when rendering them.
- Add live public-update DOM regressions covering complete and partial bundles, verified zero scores, native-score preservation and persisted diagnostics.

## [3.5.102]

- Recover immediately when browser window creation or opener detachment throws, restoring Watch instead of leaving it disabled as Opening.
- Close a newly created playback window when opener detachment fails, show a clear browser-opening warning, and allow the user to retry.
- Ignore opening failures from an obsolete view and add window-error, opener-error, retry and title-change regressions.

## [3.5.101]

- Mark a public ratings snapshot as notified only after its notification operation succeeds, allowing a later flush to retry when querying tabs temporarily fails.
- Coalesce matching notifications already in flight and protect newer successful deliveries from older failures or completions.
- Keep notification delivery outside the storage chain so outstanding tab queries cannot delay cache clearing; add failure-recovery, overlap, ordering and clear regressions.

## [3.5.100]

- Require complete Seerr route segments, so paths such as /searching, /discoveries and /movie/550junk cannot receive unrelated ratings controls or lookups.
- Validate movie, TV, collection and person IDs as positive safe integers, consistent with card-link identity checks.
- Preserve valid trailing slashes, nested pages and reverse-proxy base paths; add route, DOM and installed Chromium SPA navigation regressions.

## [3.5.99]

- Use one coverage updater for filter controls and asynchronous rating updates, preserving the visible-card count instead of overwriting it with only the scored total.
- Recalculate coverage after filtering and sorting, including refreshes that remove the last visible score and live public updates that reveal a filtered card.
- Add wrapped-card, zero-visible, Reset, conclusive-refresh and installed Chromium live-update regressions.

## [3.5.98]

- Reconcile newer verified public ratings when a pending lookup completes, preventing older provider responses from replacing scores delivered by live cache notifications.
- Preserve current public scores in both unavailable-result and rejected-refresh fallbacks while retaining server-specific IMDb/TMDB fields and persisting the corrected fallback.
- Apply the same year checks at completion and add successful, unavailable, rejected, cold-cache and contradictory-year regressions.

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

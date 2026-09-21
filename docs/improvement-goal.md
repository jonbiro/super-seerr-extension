# Super Seerr improvement goal

The full goal remains active until implementation and validation cover every row.
Browser fixtures, live sites, Firefox, installed builds, and published releases
are separate evidence categories; none substitutes for another.

| Requirement | Implementation | Validation |
| --- | --- | --- |
| Aging ratings refresh immediately from cache, then update quietly; missing sources retry sooner | Implemented: 24h full / 1h partial / 6h unrated; failures retain scores and retry in 2m | Regression tests and Chromium delayed-refresh test pass |
| Coalesced status lookups and short-lived request history with write/settings invalidation | Implemented: bounded status (15s) and history/detail (10s) reads | Concurrent reads, write failure, settings switch, expiry, bounds tested |
| Keyboard flyout, Escape, focus handling, expanded announcements | Implemented with semantic button, inert closed panel, focus return and live status | Unit tests and Chromium Enter/Space/Escape checks pass |
| Season selection with existing availability before confirmation | Implemented: shared flyout/bulk picker, standard-quality availability, explicit season arrays, fresh worker validation before writes, cancellation/navigation guards | Worker and DOM tests, Chromium full select/confirm/exact POST; Firefox shared picker selection passes |
| Missing-score reasons, source, checked time, per-title retry | Implemented for cards and detail pages; worker retains uncertain-match diagnostics | DOM retry test, diagnostic regression, Chromium UI test pass |
| Actionable Seerr/permissions/API-key/Plex popup diagnostics | Implemented: separate checks, safe messages, focused Settings repair links | Worker/DOM tests; Chromium key, Plex link, missing-permission repair; Firefox popup checks |
| Worker-mediated content cache access and trusted secret storage | Implemented: origin/path/frame/extension-validated worker bridge, bounded allowlisted schema, serialized clears, safe broadcasts; local storage trusted-only where supported | 491 unit tests; Chromium rejects content key reads while bridge/clear work; Firefox 147.0.3 bridge works but lacks local setAccessLevel |
| Seven-site browser coverage, Firefox, upgrade coverage, production-behavior tests | In progress | Chromium and Firefox cover eleven synthetic movie/TV pages across all seven supported origins using real manifest injection. Actual 3.5.2 upgrades preserve settings and migrate legacy secrets in both browsers. Nine copied-logic suites replaced with production execution. Read-only live checks exposed and fixed IMDb error-page and Trakt generic-title extraction. IMDb live media remains blocked by HTTP 403; final requirement audit pending |
| Saved filter presets | Implemented: named presets in sync storage, apply/update/delete, max 20, validated fields | DOM test verifies persistence, visible filtering, sorting, deletion |
| Local recent actions without secrets | Implemented: last 50 confirmed requests/watchlist additions, device-local, clearable, allowlisted fields | Concurrent writes, persistence/restart, secret exclusion, content-message denial, storage-failure tests; Chromium/Firefox render and clear |
| Explicit picker for ambiguous matches | Implemented: bounded worker-validated candidates, title/year/type/description, explicit choice, fresh status, separate request click, navigation cancellation | Worker/DOM tests and Chromium end-to-end candidate choice through exact request ID; Firefox real-extension candidate rendering and explicit selection pass |

Preserve settings migrations, safe identity matching, non-retrying writes,
and unrelated user work. Build versions increment through the existing Makefile.
Commit and push verified batches; do not mark the goal complete from partial work.

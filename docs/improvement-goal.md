# Super Seerr improvement goal

The full goal remains active until implementation and validation cover every row.
Browser fixtures, live sites, Firefox, installed builds, and published releases
are separate evidence categories; none substitutes for another.

| Requirement | Implementation | Validation |
| --- | --- | --- |
| Aging ratings refresh immediately from cache, then update quietly; missing sources retry sooner | Implemented: 24h full / 1h partial / 6h unrated; failures retain scores and retry in 2m | Regression tests and Chromium delayed-refresh test pass |
| Coalesced status lookups and short-lived request history with write/settings invalidation | Implemented: bounded status (15s) and history/detail (10s) reads | Concurrent reads, write failure, settings switch, expiry, bounds tested |
| Keyboard flyout, Escape, focus handling, expanded announcements | Implemented with semantic button, inert closed panel, focus return and live status | Unit tests and Chromium Enter/Space/Escape checks pass |
| Season selection with existing availability before confirmation | Pending | Pending |
| Missing-score reasons, source, checked time, per-title retry | Implemented for cards and detail pages; worker retains uncertain-match diagnostics | DOM retry test, diagnostic regression, Chromium UI test pass |
| Actionable Seerr/permissions/API-key/Plex popup diagnostics | Implemented: separate checks, safe messages, focused Settings repair links | Worker/DOM tests; Chromium key, Plex link, missing-permission repair; Firefox popup checks |
| Worker-mediated content cache access and trusted secret storage | Pending | Pending |
| Seven-site browser coverage, Firefox, upgrade coverage, production-behavior tests | In progress | Five Chromium tests pass; Firefox 147.0.3 real-extension permissions/injection/SPA/reload/cache/revocation test passes; seven-site live and upgrade checks pending |
| Saved filter presets | Implemented: named presets in sync storage, apply/update/delete, max 20, validated fields | DOM test verifies persistence, visible filtering, sorting, deletion |
| Local recent actions without secrets | Implemented: last 50 confirmed requests/watchlist additions, device-local, clearable, allowlisted fields | Concurrent writes, persistence/restart, secret exclusion, content-message denial, storage-failure tests; Chromium/Firefox render and clear |
| Explicit picker for ambiguous matches | Pending | Pending |

Preserve settings migrations, safe identity matching, non-retrying writes,
and unrelated user work. Build versions increment through the existing Makefile.
Commit and push verified batches; do not mark the goal complete from partial work.

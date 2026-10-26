# Simkl review snapshots — October 26, 2026

Version **3.5.260**, branch `master`. Reviewed imported-watchlist pagination, concurrent Settings pages, background lifetime, account changes, and private-cache access. Season-request identity/availability guards and shared-public-rating validation were also inspected; that inspection produced no additional confirmed finding. The overall review goal remains active.

## Fixed findings

- **Mixed review pages:** one Simkl Sync replaced the worker's single snapshot, so another window's Load more returned titles from the newer list. Each review now carries its own opaque snapshot ID, validated by the worker and Settings before appending rows.
- **Lost pages after worker termination:** volatile worker state disappeared between Sync and Load more. Account-bound snapshots now use private browser session storage, bounded to ten reviews and roughly 2 MB. Retired or corrupt snapshots fail with an explicit new-Sync action; malformed rows invalidate the whole snapshot rather than shifting page boundaries.
- **Unnecessary online dependency and freshness stamps:** cached pagination previously required provider permission/token refresh and advanced Last synced. It now reads locally without a provider request and preserves the actual sync stamp, including a newer stamp committed during its read.
- **Token-rotation race:** a rotating credential update during cached pagination could be mistaken for an account replacement. Cached pages now accept a stable current account revision while retaining epoch, account-replacement, and disconnect guards. Provider-network operations keep their strict credential checks.

Snapshots contain normalized titles/IDs and an account-binding hash, without raw token copies. Disconnect removes retained reviews. Browser-session retention and privacy disclosures are documented in [tracker setup](../tracker-integrations.md) and [data handling](../privacy-and-permissions.md). Browser API references: [Chrome session storage](https://developer.chrome.com/docs/extensions/reference/api/storage#property-session), [Firefox session storage](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session).

## Verification

- Original-source regressions reproduced mixed pages and failure after a worker restart: `/tmp/super-seerr-review-watchlist-snapshots-red.log`. The concurrent rotation regression also failed before correction: `/tmp/super-seerr-review-watchlist-rotation-race-red.log`.
- **80 focused unit checks passed**, including fifteen new cases for review ownership, restart, token rotation/replacement, pending writes, storage bounds with multibyte titles, corruption, offline reads, response IDs, and sync stamps. Log: `/tmp/super-seerr-review-watchlist-snapshots-complete.log`.
- The new packaged Chromium test uses provider-response fixtures, two real Settings pages, real session storage, and CDP-observed worker termination plus a fresh-worker marker. Both reviews retain their own pages. Content-script reads, tracker messages, and private session-change notifications are blocked; disconnect clears both views and the retained cache.
- Firefox **157.0.1** reads a seeded account-bound session page without provider access, preserves Last synced, rejects content-script reads/notifications, and removes the cache on disconnect. The existing actual 3.5.2 upgrade, discovery fixtures, and two-Seerr-site checks also pass.
- Firefox failure exports now use unique versioned run folders instead of overwriting a fixed diagnostics directory; the harness syntax was checked after that path-only change.
- Final full checks: **1,835 unit tests**, **330 Chromium tests**, Firefox runtime harness, `npm run check`, `git diff --check`, and both builds passed. Source, documentation, icons, metadata, and merged manifests match 3.5.260.

Final logs use `/tmp/super-seerr-review-unit-3.5.260-final.log`, `/tmp/super-seerr-review-browser-3.5.260-final.log`, and `/tmp/super-seerr-review-firefox-3.5.260-privacy-final.log`. Chromium artifacts use `/tmp/super-seerr-review-browser-3.5.260-final/`. Earlier browser setup/observation failures and subsequent passing evidence remain at `/tmp/super-seerr-review-watchlist-snapshot-browser*`.

## Remaining work

Continue the full feature review, including server request/availability contracts and cache lifecycle behavior. Live authenticated provider/Seerr/Plex acceptance and access/consent-blocked public sites remain separate checks described in the [broader review](2026-10-26.md). This pass used disposable profiles and provider fixtures; it performed no real OAuth consent or provider writes. Existing unrelated workflow deletions remain unstaged.

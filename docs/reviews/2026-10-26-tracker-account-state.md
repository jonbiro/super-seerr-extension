# Tracker account changes and private reviews — October 26, 2026

Version **3.5.258**, branch `master`. Reviewed tracker account notifications, concurrent authorization, imported watchlists, title actions, metadata recovery, and restored Settings pages. The ongoing extension review goal remains active.

## Fixed findings

- **Cross-provider blocking:** a pending Trakt connection prevented Simkl metadata from refreshing, and vice versa. Each idle provider can now refresh independently. Deferred reads resume when the affected account finishes; cancellation remains available during authorization.
- **Retired private reviews:** account changes relied on a successful follow-up metadata read before clearing imported titles. Public identity fields in storage notifications now immediately clear retired reviews and invalidate pending watchlist/title actions. Failed metadata reads keep affected controls unavailable with a recovery message while preserving unsaved Client ID edits.
- **Restored page state:** Settings restored from the browser's page cache could retain a private review until a metadata read succeeded. Restoration now retires that review and checks connection state before enabling its controls.

Per-card operation generations prevent an older public metadata reply from replacing a newer account action. Ordinary token rotations and last-sync timestamps preserve current watchlist reads.

## Verification

- Two production-UI regressions failed before the fix: a cross-provider disconnect blocked behind authorization, and retained private titles while replacement metadata was pending or failed. Evidence: `/tmp/super-seerr-review-tracker-account-change-red.log`.
- **65 focused unit checks passed**, including nine new cases for competing authorization, delayed title/watchlist replies, token rotation, stored-account deletion, restored pages, and follow-up recovery. Log: `/tmp/super-seerr-review-tracker-account-change-complete.log`.
- **20 focused Chromium checks passed**; four new cases cover both providers and successful/failed metadata reads at 320px. The final 320px failure view was also inspected for layout and recovery copy.
- Full `npm test`: **1,820 passed**. Full Chromium suite: **329 passed**. Firefox runtime harness: **passed on Firefox 157.0.1**, including the actual 3.5.2 upgrade and two saved Seerr sites.
- `npm run check`, `git diff --check`, and `make build`: passed. Both unpacked builds use 3.5.258; source, documentation, metadata, and merged manifests were compared with the checkout.

Full logs use `/tmp/super-seerr-review-{unit,browser,firefox}-3.5.258.log`; browser artifacts use `/tmp/super-seerr-review-browser-3.5.258/`. Focused browser evidence uses `/tmp/super-seerr-review-tracker-account-change-browser*`.

## Remaining work

Continue reviewing account/import snapshots and cache lifecycle behavior. Authenticated live Seerr/Plex actions, provider OAuth consent, and access/consent-blocked sites remain separate acceptance checks in the [broader review](2026-10-26.md). This pass used local fixtures and disposable profiles. Existing unrelated workflow deletions remain unstaged.

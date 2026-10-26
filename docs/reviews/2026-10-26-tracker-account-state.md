# Tracker account state and watchlist contract — October 26, 2026

Version **3.5.259**, branch `master`; account-state fixes first landed in 3.5.258. Reviewed tracker account notifications, concurrent authorization, imported watchlists, title actions, metadata recovery, restored Settings pages, and Trakt's provider contract. The ongoing extension review goal remains active.

## Fixed findings

- **Cross-provider blocking:** a pending Trakt connection prevented Simkl metadata from refreshing, and vice versa. Each idle provider can now refresh independently. Deferred reads resume when the affected account finishes; cancellation remains available during authorization.
- **Retired private reviews:** account changes relied on a successful follow-up metadata read before clearing imported titles. Public identity fields in storage notifications now immediately clear retired reviews and invalidate pending watchlist/title actions. Failed metadata reads keep affected controls unavailable with a recovery message while preserving unsaved Client ID edits.
- **Restored page state:** Settings restored from the browser's page cache could retain a private review until a metadata read succeeded. Restoration now retires that review and checks connection state before enabling its controls.
- **Trakt route mismatch:** the worker sent `movies,shows` for a combined watchlist, while the [provider's own route contract](https://github.com/trakt/trakt-api/blob/b2308e4a078e4f4779871580bc7895f0e8b6a98d/projects/api/src/contracts/users/subroutes/watchlist.ts) defines `movie,show`. The worker now follows that contract. A strict route fixture reproduces a 404 with the former path and verifies movie/TV imports across two pages after correction. This corrects 3.5.249 and replaces a test that only asserted its implementation string. The fixture is not an authenticated live Trakt result.

Per-card operation generations prevent an older public metadata reply from replacing a newer account action. Ordinary token rotations and last-sync timestamps preserve current watchlist reads.

## Verification

- Two production-UI regressions failed before the fix: a cross-provider disconnect blocked behind authorization, and retained private titles while replacement metadata was pending or failed. Evidence: `/tmp/super-seerr-review-tracker-account-change-red.log`.
- Trakt contract evidence: the official `trakt/api-help` repository redirects to `trakt/trakt-api`; its combined watchlist contract and `added` sort were read through GitHub's API. The route fixture failed before correction and passed afterward: `/tmp/super-seerr-review-trakt-contract-{red,green}.log`.
- **65 focused unit checks passed**, including nine new cases for competing authorization, delayed title/watchlist replies, token rotation, stored-account deletion, restored pages, and follow-up recovery. Log: `/tmp/super-seerr-review-tracker-account-change-complete.log`.
- **20 focused Chromium checks passed**; four new cases cover both providers and successful/failed metadata reads at 320px. The final 320px failure view was also inspected for layout and recovery copy.
- Full `npm test`: **1,820 passed**. Full Chromium suite: **329 passed**. Firefox runtime harness: **passed on Firefox 157.0.1**, including the actual 3.5.2 upgrade and two saved Seerr sites.
- `npm run check`, `git diff --check`, and `make build`: passed. Both unpacked builds use 3.5.259; source, documentation, metadata, and merged manifests were compared with the checkout.

Final full logs use `/tmp/super-seerr-review-{unit,browser,firefox}-3.5.259.log`; browser artifacts use `/tmp/super-seerr-review-browser-3.5.259/`. Earlier 3.5.258 results and focused browser evidence at `/tmp/super-seerr-review-tracker-account-change-browser*` are retained.

## Remaining work

Continue reviewing account/import snapshots and cache lifecycle behavior. Authenticated live Seerr/Plex actions, provider OAuth consent, and access/consent-blocked sites remain separate acceptance checks in the [broader review](2026-10-26.md). This pass used local fixtures and disposable profiles. Existing unrelated workflow deletions remain unstaged.

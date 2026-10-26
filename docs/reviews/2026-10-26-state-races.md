# Settings and preset race review — October 26, 2026

Version: **3.5.255**, branch `master`. Continuation of the [broader extension review](2026-10-26.md). The ongoing goal still covers single-site behavior, multiple Seerr sites, shared public ratings, and all extension features; these fixes do not close that goal.

## Fixed

- **Obsolete popup diagnostics:** the message handler created a detached client, hiding live settings changes from the diagnostic method's existing guard. It now calls the guarded method on the live worker, which snapshots only its network client. Four message-listener regressions reproduced stale replies after URL, API-key, Plex-token, and settings-generation changes; they now reject the report before further authentication.
- **Preset controls released by old replies:** a Save/Delete completion could unlock controls while a newer storage refresh was pending, or unlock another save started after that refresh. The newest operation now owns both the disabled state and initiating keyboard focus. Ten production-UI regressions cover successful/failed operations and both overlapping-write cases; eight browser regressions cover reply ordering and focus moved outside the toolbar.

## Verification

- `npm test`: **1,800 passed**.
- `npm run test:browser`: **280 passed**, including the real-extension single-site, multi-site/separate-cache, shared-rating updates, worker restart, upgrade, and preset/focus cases.
- `npm run test:firefox`: **passed on Firefox 157.0.1**, including two saved sites and the actual 3.5.2 upgrade.
- `npm run check`, `git diff --check`, and `make build`: passed. Both generated targets use version 3.5.255; source, documentation, and manifest parity were checked.

Logs and browser evidence use `/tmp/super-seerr-review-{unit,browser,firefox}-3.5.255*`. Initial failing regressions are retained at `/tmp/super-seerr-review-diagnostic-message-red.log` and `/tmp/super-seerr-review-preset-ownership-red.log`; the focused passing checks use matching `*-green.log` files and `/tmp/super-seerr-review-state-ownership-browser*`.

## Still pending

Continue feature and lifecycle review; no claim is made that every possible bug is resolved. Live-site access/consent blocks and real authenticated Seerr/Plex/OAuth acceptance remain as documented in the broader review. This continuation used local fixtures and no account credentials or live service writes. Existing unstaged workflow deletions were preserved.

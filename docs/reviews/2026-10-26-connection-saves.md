# Connection saves and tracker focus — October 26, 2026

Version **3.5.256**, branch `master`. The ongoing review goal includes single-site behavior, multiple Seerr sites, shared public ratings, and every extension feature; it remains active.

## Fixed findings

- **Single-site credential mismatch:** unnamed saves previously wrote the URL to sync storage and its key to local storage independently. A delayed or failed key write could send the old server's key to the new URL. All Settings saves now use the existing serialized, atomic local connection record. Legacy settings stay readable until an explicit save; overlay preferences still sync.
- **Misleading save failures:** a connection could be committed before preferences or a refresh failed. The error now identifies the completed connection save and the failed follow-up, retaining the confirmed site identity for retries.
- **Blocked legacy repair:** malformed or credential-bearing legacy URLs could make the worker reject even a corrected connection. Invalid legacy URLs now produce no virtual saved site. The old local key stays untouched until an explicit valid save commits its replacement. Corrupt saved profile containers still fail closed.
- **Tracker focus loss:** pagination replaced every existing title row and hid the final Load more button, losing keyboard focus. New pages append their rows, preserving a focused existing title. Sync/pagination focus newly loaded titles when the initiating control still owns focus; empty lists, failed reads, and declined permissions retain a usable control. Moving focus elsewhere is respected.

## Evidence

- Production Options and worker integration reproduced the credential mismatch during a delayed write and after a failed write. Nine regressions now cover pending/completed/failed saves, follow-up failures, restarts, and invalid legacy URL repair.
- Trakt and Simkl pagination failed four browser focus checks before the fix. Eleven new browser checks cover both providers, existing title focus, unrelated controls, and initial Sync outcomes.
- Save-related unit fixtures now call the actual worker connection handler. Browser setup waits for a confirmed Save and verifies the authoritative saved connection, rather than only legacy fields or script registration.
- `npm test`: **1,809 passed**. `npm run test:browser`: **291 passed**. Firefox runtime harness: **passed on Firefox 157.0.1**, including saved-site switching and the actual 3.5.2 upgrade.
- `npm run check`, `git diff --check`, and `make build`: passed. Source, docs, metadata, and both generated manifests were compared at 3.5.256.

Final logs: `/tmp/super-seerr-review-unit-3.5.256-final.log`, `/tmp/super-seerr-review-browser-3.5.256.log`, and `/tmp/super-seerr-review-firefox-3.5.256.log`; Chromium artifacts use `/tmp/super-seerr-review-browser-3.5.256/`. Initial failing evidence uses `/tmp/super-seerr-review-atomic-settings-red.log`, `/tmp/super-seerr-review-legacy-url-repair-red.log`, and `/tmp/super-seerr-review-tracker-pagination-red*`.

## Remaining work

Continue reviewing account reconnection and cache freshness around settings changes. Real authenticated Seerr/Plex actions, provider OAuth consent, and live sites blocked by access/consent remain separate verification work as recorded in the [broader review](2026-10-26.md). This pass used disposable browser profiles and local fixtures, with no real credentials or live service writes. Existing workflow deletions remain unstaged.

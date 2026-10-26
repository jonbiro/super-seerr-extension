# Settings focus and permission recovery — October 26, 2026

Version **3.5.257**, branch `master`. Continuation of the [broader review](2026-10-26.md). The ongoing review goal remains active.

## Fixed findings

- **Settings focus loss:** disabling an initiating control could leave focus on the page body. Save, connection tests, reload, cache clearing, editing, activation, removal, and host access now restore a usable control after success or failure. Clearing the final cache entry focuses its count; granting access focuses the server field when the warning disappears. Later focus choices are respected, including when that later control is subsequently removed.
- **Competing saved-site reads:** a cross-window refresh could supersede a focused Retry and discard its focus ownership. Settings and the popup now preserve that ownership until the newest read completes, independent of reply ordering. Failed reads keep Retry usable.
- **Host access recovery:** repeated Grant access clicks could start duplicate permission requests. A failed storage read after granting access could also reject without a handled recovery state. The action now has a pending guard and a clear recovery message while retaining unsaved values.

## Verification

- Original-source checks reproduced Save/cache focus loss, duplicate grants, unhandled permission reads, and superseding Settings reads. Failing evidence uses `/tmp/super-seerr-review-settings-focus-red*`, `/tmp/super-seerr-review-permission-grant-red.log`, and `/tmp/super-seerr-review-site-retry-superseded-red*`.
- Focused browser checks: **43 passed**, including 320px Settings, success/failure, competing reads in both orders, later focus choices, and Tab after clearing the final cache entry.
- Full `npm test`: **1,811 passed**. Full Chromium suite: **325 passed**. Firefox runtime harness: **passed on Firefox 157.0.1**, including the actual 3.5.2 upgrade and two saved sites.
- `npm run check`, `git diff --check`, and `make build`: passed. Both unpacked builds use 3.5.257; source, documentation, metadata, and merged manifests were compared with the checkout.

Full logs use `/tmp/super-seerr-review-{unit,browser,firefox}-3.5.257.log`; Chromium artifacts use `/tmp/super-seerr-review-browser-3.5.257/`. Focused evidence uses `/tmp/super-seerr-review-focus-final*` and `/tmp/super-seerr-review-options-popup-focused.log`.

## Remaining verification

Continue reviewing feature and account/cache lifecycle behavior. Real authenticated Seerr/Plex actions, provider OAuth consent, and access/consent-blocked live sites remain separate acceptance checks as documented in the broader review. This pass used local fixtures and disposable profiles. Existing unrelated workflow deletions remain unstaged.

# Super Seerr handoff to Claude

## Latest review checkpoint — 2026-10-26

This checkpoint supersedes the delivery, test, and goal status in the older snapshots below. Checkout: `/Users/yoni/super-seerr-extension`, branch `master`, remote `git@github.com:jonbiro/super-seerr-extension.git`. Current source and unpacked builds are **3.5.257**. Check `git status`, `git log -1`, and the matching GitHub Actions run for publishing state.

- The ongoing review goal is **active**, not complete, at this checkpoint. It covers single-site behavior, multiple Seerr sites, shared ratings, and every extension feature. Recheck Codex goal metadata when resuming.
- Latest fixes restore Settings action focus, retain saved-site Retry focus across competing reads, prevent duplicate host-access requests, and recover from failed permission-state reads. See [the current findings and evidence](reviews/2026-10-26-settings-focus.md).
- Local verification: **1,811 unit tests**, **325 Chromium tests**, Firefox **157.0.1** runtime harness, source checks, both builds, and generated-file parity passed.
- Previous review checkpoints: [broad feature review](reviews/2026-10-26.md), [settings/preset races](reviews/2026-10-26-state-races.md), and [atomic connection saves/tracker focus](reviews/2026-10-26-connection-saves.md).
- Pending acceptance: authenticated live Seerr/Plex actions, provider OAuth consent with registered app IDs, and live sites blocked by access challenges or consent. Continue bounded bug review without claiming these have passed.
- Preserve the two unstaged workflow deletions, existing evidence and release artifacts, and unrelated files. Stage exact task-owned paths. Do not use VoiceOver or `make clean`.

## Previous continuation snapshot — 2026-10-25 (superseded)

This snapshot supersedes the older status below. Checkout: `/Users/yoni/super-seerr-extension`, branch `master`, remote `git@github.com:jonbiro/super-seerr-extension.git`. Version **3.5.241** includes the new integrations. Use `git status` and `git log -1` for delivery state; this document records local verification before commit/CI.

- Added Simkl and JustWatch discovery adapters, localized JustWatch routes, safe title exploration links, a saved streaming region, and Copy title for Simkl search.
- Added Trakt/Simkl public-app setup and PKCE account connections in Settings. Manual Sync imports up to 500 planned titles for review; Find in Seerr opens a fresh search in the active site. It does not perform provider writes or submit Seerr requests automatically.
- Fixed mismatched TMDB IDs being trusted when only the year matched, stale account responses, rotating token-refresh races, and challenge-page false titles.
- Corrected Firefox's authentication/content transmission declarations. New discovery hosts need explicit approval after a Firefox upgrade; the runtime harness now verifies that grant before site injection.
- The tracked Codex goal is **paused**, not complete, as verified with `get_goal`. This directly requested integration work did not change that goal metadata.

Main new files: `src/background/TrackerAccounts.js`, `src/options/tracker-accounts.js`, `src/options/tracker-accounts.css`, `src/content/simkl-integration.js`, `src/content/justwatch-integration.js`. Shared discovery controls are in `src/shared/UIComponents.js`. Setup instructions: `docs/tracker-integrations.md`; draft store disclosure: `CHROMEWEBSTORE.md`. Source/build/test locations in the historical project map below remain useful; there are now nine discovery integrations.

Verified locally on current source:

- **1,676** unit/DOM/property tests passed: `/tmp/super-seerr-unit-3.5.241-final.log`.
- **268** Chromium browser tests passed: `/tmp/super-seerr-browser-3.5.241.log`, artifacts `/tmp/super-seerr-browser-3.5.241`.
- Firefox **157.0.1** runtime smoke passed, including 3.5.2 upgrade, twenty site fixtures, permissions, cache restart/clearing and two Seerr sites: `/tmp/super-seerr-firefox-3.5.241-final.log`.
- Settings inspected at 320, 390 and 1440px. Review images: `/tmp/super-seerr-tracker-settings-review-final-{320,390,1440}.png`; later Simkl guidance explicitly names AUTH V2 and passed the same layout cases.
- Both unpacked builds are at `dist/chrome` and `dist/firefox`; source parity, `npm run check` and `git diff --check` passed. Version was incremented once; the final refresh used `make -o build-version build` to retain 3.5.241.

Live evidence and remaining acceptance:

- JustWatch's US Fight Club page passed title/year extraction and a 390px flyout check. JustWatch TV pages and Simkl were blocked by HTTP 403. Preserve `test-results/live-sites-justwatch-simkl.json` and the separate `test-results/live-sites-simkl.json`; the latter confirms zero false flyouts on both Simkl challenge pages after the fix.
- Real OAuth remains unverified: the user has no registered Trakt/Simkl Client IDs. Settings provides registration links, exact callback URLs and public-app instructions. Do not register accounts, share secrets, claim provider acceptance, or infer live success from fixtures.
- Store signing/publication, authenticated live multi-server writes, and blocked public-page checks remain outside the verified results. No store release was performed.
- Commit/push only task-owned paths after verification. Preserve the two unrelated deleted workflow files unstaged, all earlier evidence, root release artifacts, and `Puppy_Dash_Basecamp`; do not use VoiceOver or `make clean`.

## Historical snapshot — 2026-10-11 (superseded)

Verified locally on 2026-10-11. Start in `/Users/yoni/super-seerr-extension`.

## Current state

- Git branch: `master`; remote: `git@github.com:jonbiro/super-seerr-extension.git`.
- HEAD: `bc4535e` (3.5.235), “Recognize host-hidden card wrappers in sorting and coverage.” Local master matches local `origin/master`; no remote fetch was performed for this handoff.
- Working source and both unpacked builds: **3.5.236**, not yet committed or pushed.
- The pasted 3.5.222 status is superseded. Its narrow filter grid fix is already in subsequent history; do not reimplement it.
- Codex's tracked goal is currently **active**, not paused: “Keep reviewing the extension, the single site functionality, and the multi-site support and shared ratings cache for more bugs or visual defects and fix them.” Goal thread ID: `01a0c185-f8df-7750-a077-1a4efd3c8d47`. This metadata is managed by Codex, not a repository task file. The open-ended goal is not complete.
- This handoff did not launch Claude, commit changes, publish a release, or alter goal status.

## Work ready for review and commit

Two reproduced bugs are fixed in `/Users/yoni/super-seerr-extension/src/content/seerr-integration.js`:

1. Host card/wrapper `display` rules marked `!important` could defeat filtering. Temporary filter hiding now uses `display:none !important`, retaining the original inline value and priority for restoration.
2. A host stylesheet can override the HTML `hidden` attribute. Visibility checks now use computed display when available, so counts and sorting follow rendered visibility rather than treating the attribute as conclusive.

Regression coverage is in `/Users/yoni/super-seerr-extension/tests/dom-integration.test.js` and `/Users/yoni/super-seerr-extension/tests/browser/filter-visual.spec.cjs`. Both new DOM regressions failed before the fix. Browser coverage exercises important flex/grid styles, hidden attributes overridden by CSS, threshold filtering, counts, and Reset restoring host styles.

Modified project files (all unstaged):

- `/Users/yoni/super-seerr-extension/CHANGELOG.md`
- `/Users/yoni/super-seerr-extension/README.md`
- `/Users/yoni/super-seerr-extension/manifest.base.json`
- `/Users/yoni/super-seerr-extension/package.json`
- `/Users/yoni/super-seerr-extension/package-lock.json`
- `/Users/yoni/super-seerr-extension/src/content/seerr-integration.js`
- `/Users/yoni/super-seerr-extension/tests/dom-integration.test.js`
- `/Users/yoni/super-seerr-extension/tests/browser/filter-visual.spec.cjs`

This handoff itself adds `/Users/yoni/super-seerr-extension/docs/claude-handoff.md`. Review whether to include it in the commit; it is a snapshot and should not be treated as evergreen status.

## Verification and evidence

Current 3.5.236:

- Unit/DOM/property suite: **1,562 passed**, zero failures/skips. `/tmp/super-seerr-unit-3.5.236.log`.
- Targeted Chromium suite: **81 passed** across filter visuals, presets, and connections. `/tmp/super-seerr-browser-3.5.236.log`; output directory `/tmp/super-seerr-browser-3.5.236`.
- Focused DOM suite: **110 passed**. `/tmp/super-seerr-css-priority-fixed.log`; before-fix reproduction `/tmp/super-seerr-css-priority-repro.log`.
- Both builds completed. `/tmp/super-seerr-build-3.5.236.log`.
- `npm run check`, `git diff --check`, and source parity against both builds passed again during handoff preparation.
- Firefox runtime smoke suite now passes on **Firefox 157.0.1**, with **geckodriver 0.37.1** installed through Homebrew at `/opt/homebrew/bin/geckodriver`. This includes packaged site fixtures, upgrades, and switching between two independent Seerr fixtures. Evidence: `/tmp/super-seerr-firefox-geckodriver-install-20261011.log`.
- Full Chromium suite on 3.5.236: **245 passed**. Evidence: `/tmp/super-seerr-browser-3.5.236-full.log`; output directory `/tmp/super-seerr-browser-3.5.236-full`. Prior 3.5.235 full suite passed 244 tests.
- No unit or browser test runner was active during handoff inspection. Several Playwright MCP server processes exist; do not terminate them merely because they are present.

Filter screenshots from the earlier responsive layout work remain at `/tmp/super-seerr-filter-grid-{320,390,600,768,1024,1280,1440}.png`. These show the earlier layout, not new 3.5.236 screenshot evidence. Temporary files may disappear after restart.

Live-site evidence to preserve:

- `/Users/yoni/super-seerr-extension/test-results/live-sites-trakt-metacritic.json`
- `/Users/yoni/super-seerr-extension/test-results/live-sites-imdb-letterboxd-rt.json`
- `/Users/yoni/super-seerr-extension/test-results/live-sites-imdb.json`
- `/Users/yoni/super-seerr-extension/test-results/ratings-details.png`
- `/Users/yoni/super-seerr-extension/docs/live-site-checks.md`
- `/Users/yoni/super-seerr-extension/docs/live-site-results.json`

Prior live checks reported Trakt and Letterboxd success, IMDb HTTP 403, and a Rotten Tomatoes consent overlay blocking interaction. Metacritic year extraction was checked. These were not rerun for this handoff. Use uniquely named evidence outputs rather than overwriting reports. Live authenticated multi-server writes remain unverified; Firefox runtime smoke fixtures now pass, but fixture success is not live-provider proof. Earlier historical docs contain Firefox results for older versions, not this version.

## Next steps

1. Inspect the current diff and this handoff; preserve unrelated deletions below.
2. Full Chromium validation on 3.5.236 is now complete (245 passed). Repeat only after relevant source edits; use a fresh output directory and preserve diagnostic evidence.
3. The build is already current and byte-for-byte matches source. Do not invoke `make build` merely to verify again: it increments the patch version. Rebuild after source edits and update the changelog accordingly.
4. Commit and push verified project files explicitly. User has previously authorized committing/pushing completed work. Never use blanket staging while the unrelated workflow deletions exist.
5. Continue a bounded review of filter visuals, single-site behavior, multi-site switching, and shared ratings cache. Reproduce bugs before claiming them; add behavior regressions for substantive fixes.
6. Revisit live Trakt in-place updates and blocked live sites if practical, with fresh evidence names. Consent/403 failures alone are not confirmed extension defects.

Potential investigation leads, **not confirmed bugs**:

- The card observer watches href/src/srcset/alt; host changes only to style/class/hidden may leave counts or sort stale until another update. Avoid observer loops caused by extension-owned mutations if addressing this.
- Visibility checks cover the card and its single-card list wrapper, not arbitrary hidden ancestors.
- Rating queue priority remeasurement over large grids may be expensive; obtain performance evidence before changing scheduling.

## Preservation and user preferences

- Leave these pre-existing tracked deletions unstaged and untouched: `/Users/yoni/super-seerr-extension/.github/workflows/ci.yml` and `/Users/yoni/super-seerr-extension/.github/workflows/release.yml`.
- Do not restore/delete/reset unrelated work. `Puppy_Dash_Basecamp` is unrelated and was accidentally included in the project folder historically.
- Do not enable or use VoiceOver. Other keyboard/focus checks remain appropriate.
- Preserve diagnostics, unique bug evidence, credentials, local databases, Git history, and root release archives/checksums.
- Do not run `make clean`: it deletes preserved release archives.
- Do routine reversible work autonomously. Report actual checks and limitations. Do not claim store publication or daily-browser installation.
- Default model preference is GPT-6.1 Sol for Codex; this is not a request to change Claude's model. No subagents are requested by this handoff.

## Project map

All project paths below are under `/Users/yoni/super-seerr-extension`:

| Location | Purpose |
| --- | --- |
| `/Users/yoni/super-seerr-extension/src/content/` | Nine site integrations, Seerr ratings overlay/filter, queue, cache client, session and preset UI |
| `/Users/yoni/super-seerr-extension/src/content/seerr-integration.js` | Card discovery, filter/sort/count behavior, overlay actions |
| `/Users/yoni/super-seerr-extension/src/content/seerr-overlay.css` | Overlay and responsive filter styles; narrow four-action grid at <=600px |
| `/Users/yoni/super-seerr-extension/src/background/` | Worker, providers, storage, permissions, Seerr transport/caches, connection management |
| `/Users/yoni/super-seerr-extension/src/background/background.js` | Worker wiring and message routing |
| `/Users/yoni/super-seerr-extension/src/background/SeerrConnections.js` | Saved sites, active selection, credential pairing and connection guards |
| `/Users/yoni/super-seerr-extension/src/background/PublicRatings.js` | Verified public ratings sharing and sanitization |
| `/Users/yoni/super-seerr-extension/src/background/OverlayStorage.js` | Validated worker storage bridge and per-site overlay caches |
| `/Users/yoni/super-seerr-extension/src/background/SeerrReadCache.js` | Server-specific reads and in-flight sharing |
| `/Users/yoni/super-seerr-extension/src/background/RottenTomatoes.js` | Provider lookup and generation checks |
| `/Users/yoni/super-seerr-extension/src/background/RtCache.js` | Provider cache persistence |
| `/Users/yoni/super-seerr-extension/src/shared/` | Shared UI, media validation/extraction, rating model/config, client and season picker |
| `/Users/yoni/super-seerr-extension/src/shared/BaseIntegration.js` | External-site lifecycle, status, request/watchlist and title-picker actions |
| `/Users/yoni/super-seerr-extension/src/options/` | Settings, saved servers, diagnostics/support tools |
| `/Users/yoni/super-seerr-extension/src/popup/` | Popup connection controls, diagnostics, recent actions |
| `/Users/yoni/super-seerr-extension/tests/` | Node unit/DOM/property regressions |
| `/Users/yoni/super-seerr-extension/tests/helpers/` | Production-code execution helpers |
| `/Users/yoni/super-seerr-extension/tests/browser/` | Chromium fixtures, Firefox smoke and live-site utilities |
| `/Users/yoni/super-seerr-extension/tests/manual/` | Manual test guidance |
| `/Users/yoni/super-seerr-extension/test-results/` | Ignored existing diagnostic evidence; preserve |
| `/Users/yoni/super-seerr-extension/scripts/` | Version bump, validation, signing and update preparation |
| `/Users/yoni/super-seerr-extension/docs/` | Design, requirements, guides, historical goal audits, releases and this handoff |
| `/Users/yoni/super-seerr-extension/docs/improvement-goal.md` | Historical original improvement completion audit; its test/version totals are old |
| `/Users/yoni/super-seerr-extension/docs/next-improvement-goal.md` | Historical later milestone and external signing/publication gates |
| `/Users/yoni/super-seerr-extension/dist/chrome/` | Current ignored unpacked Chromium build; load unpacked from here |
| `/Users/yoni/super-seerr-extension/dist/firefox/` | Current ignored unpacked Firefox build; manifest here for temporary installation |
| `/Users/yoni/super-seerr-extension/icons/` | Extension icons |
| `/Users/yoni/super-seerr-extension/screenshots/` | Screenshot folder |
| `/Users/yoni/super-seerr-extension/node_modules/` | Installed development dependencies |
| `/Users/yoni/super-seerr-extension/.git/` | Git history/index/config; preserve |
| `/Users/yoni/super-seerr-extension/.remember/` | Existing local context; preserve, do not assume safe to publish |
| `/Users/yoni/.codex/visualizations/2026/09/21/01a0c185-f8df-7750-a077-1a4efd3c8d47/` | Additional workspace visualization root; not audited in this handoff |

Root release ZIP/XPI/checksum sets observed: 3.5.11, 3.5.12, 3.5.13, 3.5.32 and 3.5.33. Preserve them. Current unpacked builds are not equivalent to newly signed release packages.

## Architecture invariants

- Share verified public provider ratings across sites. Keep server-specific status, availability, request history, credentials, title corrections and overlay context isolated by site/account as implemented.
- Snapshot site/credential/generation state across async operations; reject retired replies before rendering or writing.
- Preserve partial ratings; RT confidence gate remains 0.7. Provider ratings can work without a Seerr API key; request/watchlist actions require configuration.
- Never automatically retry writes with an uncertain outcome. Ambiguous title choices require review; do not guess the first search result.
- Credentials remain device-local. Content scripts use the worker cache bridge. Do not put secrets in logs, handoffs, sync storage or commits.

## Commands and build caveats

Run from `/Users/yoni/super-seerr-extension`, with Node >=22.13.0:

- `npm test`
- `npm run check`
- `npx playwright test --output=/tmp/<fresh-project-specific-directory>`
- `npm run test:firefox` (requires working Firefox/geckodriver setup; report blockers honestly)
- `git diff --check`
- `diff -qr src dist/chrome/src` and `diff -qr src dist/firefox/src`
- `make build` only when rebuilding is needed; it increments patch and synchronizes source manifest, package/lockfile and README. Add changelog entry before building; build before running version-sensitive tests.

Playwright config is `/Users/yoni/super-seerr-extension/playwright.config.cjs`, uses one worker and retains traces on failure. Build/release details are in `/Users/yoni/super-seerr-extension/Makefile` and `/Users/yoni/super-seerr-extension/docs/releases.md`.

## Suggested skills

If available in Claude's environment, use a bug-diagnosis skill for concrete reproductions and a code-review skill for the final diff. Use browser/visual-audit tooling for rendered filter checks. Read applicable skill instructions before invoking them; no particular skill or background-agent launch is required to continue.

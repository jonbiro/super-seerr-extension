# Super Seerr handoff to Claude

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
| `/Users/yoni/super-seerr-extension/src/content/` | Seven site integrations, Seerr ratings overlay/filter, queue, cache client, session and preset UI |
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

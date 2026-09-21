# Runtime modules and verification

## Boundaries

Runtime code remains plain JavaScript with no bundling step. The background entry imports side-effect modules and explicitly composes their methods onto `SeerrAPI`; module methods share that instance's configuration and cache state. Content scripts load factories in the order declared by `OVERLAY_SCRIPT_FILES`.

| Module | Responsibility |
| --- | --- |
| `src/background/background.js` | Browser events, settings/migration, overlay registration, message dispatch, request orchestration |
| `src/background/SeerrTransport.js` | Authenticated HTTP transport, deadlines, response/error handling |
| `src/background/SeerrMatching.js` | Search variants and conservative identity matching for writes |
| `src/background/MediaStatus.js` | Request/media enum mapping and user-facing status |
| `src/background/RottenTomatoes.js` | RT fetching, parsing, matching, lookup coalescing |
| `src/background/RtCache.js` | Worker persistence, bounds, and coordinated cache clearing |
| `src/shared/MediaValidation.js` | Positive safe-integer IDs, media types, and request payload validation |
| `src/content/OverlayCache.js` | Per-tab ratings persistence and clear-generation handling |
| `src/content/SeerrSession.js` | Session-authenticated reads and per-title ratings resolution |
| `src/content/RatingsPresentation.js` | Pure score parsing, bundle merging, quality summaries |
| `src/content/seerr-integration.js` | Page indexing, navigation, DOM rendering, sorting and bulk actions |

The source check validates imported module paths as well as static and dynamically registered content-script files. Test helpers evaluate the production modules rather than maintaining copies of their implementations.

## Safety contracts

- Without a known ID, a request requires one distinct candidate matching the full normalized title and media type. A supplied year must agree within one year. Search variants change the query, never the identity being validated. Ambiguous/unmatched titles are selected explicitly in Seerr instead of guessed.
- Media POSTs are sent once. A missing message reply is an **unknown outcome**, not permission to retry. Read-only status messages retain bounded retries.
- Failed search/detail/request-list reads produce an error with a status-retry action. They are not equivalent to an empty media record.
- Startup waits for migration, configuration, and script registration, not public server metadata. Late metadata responses cannot override a newer server's name.
- Cache clearing is owned by the worker. It invalidates memory and in-flight RT results, waits for writes already running, removes both persisted ratings layers and endpoint availability, then publishes a new cache epoch. Open tabs invalidate pending resolutions and flushes. Epoch-stamped writes from an old tab cannot be served after a subsequent load, even if they finish after the clear.

## Firefox verification (opt-in)

Install Firefox and geckodriver 0.36 or newer, then run:

```sh
npm run test:firefox
# When either executable is not discoverable:
GECKODRIVER_PATH=/path/to/geckodriver FIREFOX_BINARY=/path/to/firefox npm run test:firefox
```

This separate Node/WebDriver harness uses a temporary addon, profile, and the same local HTTP fixtures as Chromium. It is intended to cover optional permission grant/revocation, main- and isolated-world injection, SPA navigation, background restart via addon reload, and persisted cache clearing. Firefox permissions are granted through its own permission manager in the disposable test session, not by replacing extension API methods. Privileged WebDriver access is enabled solely for that test session.

**Current limitation:** this harness has not completed successfully locally. Installed Firefox 147.0.3 did not initialize its WebDriver session; clean Firefox 155/156 builds exited with `Could not find profile folder`. These failures happen before addon installation. The test does not repair, remove, or modify an existing browser profile to work around the problem. Runtime compatibility remains unverified, and this command is intentionally not part of required CI until it has passed on a working Firefox environment.

Startup failures save `test-results/firefox/geckodriver.log`; failures after session creation also save a screenshot when possible. The harness terminates its test process group and removes its temporary extension/profile on exit. No additional automation-library dependency is required.

## Automated checks

```sh
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

On Linux CI, install browser system dependencies with `npx playwright install --with-deps chromium`.

Browser tests create a temporary unpacked extension and an isolated browser profile from current source. They do not run Make, bump versions, touch your real browser profile, use a real API key, or contact a live Seerr server. A local HTTP fixture supplies Seerr pages and API responses.

Coverage includes:

- Saving configuration without permission, granting optional host access, registering both isolated- and main-world scripts, and revocation.
- Real isolated-world injection, SPA navigation to an unsupported route and back, and no duplicate badges.
- Terminating the MV3 worker through CDP, observing fresh memory backed by persisted configuration/cache, and clearing the persisted cache.

Native permission bubbles are outside Playwright's page automation. Tests grant access through Chromium's extension-manager API (the same browser-side operation behind its site-access UI), then use the real Settings form and `chrome.permissions.remove`. Unit tests separately check the user-gesture ordering and declined-permission save behavior. No production permission API is mocked in the browser suite.

Failures retain `test-results/**/trace.zip`; inspect with `npx playwright show-trace <path>`. CI uploads these artifacts. Chromium is the verified CI browser target. Firefox packaging and manifest checks remain automated; the separate Firefox harness below is not yet a verified runtime check.

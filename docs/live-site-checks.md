# Read-only live compatibility checks

Run `node tests/browser/live-sites.cjs` from the repository root. The command uses
an isolated Chromium profile with the current extension source, no credentials,
and no request or watchlist writes. It opens the extension panel for layout checks.

The suite covers every movie/TV contract URL, revisits sites in the same tab,
checks a Spanish TMDB title and Polish Filmweb pages, and measures the opened
panel at 390×600 after allowing its transition to settle. Live HTML is used,
including redirects to newer site layouts. Synthetic fixture coverage remains
separate and is not evidence that a live site works.

Results are written to `test-results/live-sites.json`, including time, source
version, browser version, expected/extracted titles, media type, locale,
navigation, final URL, HTTP status and panel bounds.

- `pass`: title, media type, single flyout and viewport bounds were verified.
- `blocked`: HTTP 401/403/429, an identifiable access challenge, or a host consent dialog intercepting the panel control.
- `site-unavailable`: another HTTP error or failed navigation.
- `failed`: the page loaded but an extension assertion or interaction failed.

Every non-pass keeps the command exit status nonzero. For HTTP errors, the suite
also verifies that the extension does not invent a requestable title. Access
blocks and unavailable sites are never counted as compatibility passes.

This is sampled coverage, not a guarantee for every title, region or site layout.

Use `LIVE_SITES=filmweb node tests/browser/live-sites.cjs` for a targeted rerun; its report is saved separately as `test-results/live-sites-filmweb.json`.

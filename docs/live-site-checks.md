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

## Follow-up: IMDb, Letterboxd and Rotten Tomatoes (2026-09-20)

Compared an isolated Chromium run with normal Chrome, opening panels without
sending requests or watchlist writes:

| Site | Isolated Chromium | Normal Chrome |
| --- | --- | --- |
| IMDb, The Shawshank Redemption | HTTP 403; verified no false requestable title | Page and panel loaded; correct title and 1994 |
| Letterboxd, Fight Club | HTTP 200; title, type and 390×600 panel layout passed | Page and panel loaded; correct title and 1999 |
| Rotten Tomatoes, Fight Club | HTTP 200; panel layout passed; 1999 extracted | Not part of the normal-profile follow-up |
| Rotten Tomatoes, Breaking Bad | HTTP 200; OneTrust intercepts panel clicks, so still blocked | Panel opened after dismissing the site's app promotion |

The Letterboxd timeout did not reproduce. IMDb access differs by environment;
normal Chrome success does not establish compatibility in blocked profiles.
Rotten Tomatoes consent remains a separate host interaction gate in the isolated
run; the test does not force clicks through it or count the case as a pass.

The normal-profile RT TV panel exposed a real defect: “Unknown Year” despite the
page's hero showing 2008–2013. Version 3.5.35 reads the primary hero metadata and
uses the premiere year. A subsequent isolated live run extracted “2008 • TV
Series”; opening that panel remained consent-blocked. The installed normal-profile
extension version was not established, and it was not reloaded with this fix.

Validation: 540 unit tests passed before the build; the sole failure was the
new changelog version being ahead of the manifest. After `make build` produced
3.5.35, all three changelog/version tests passed. All 31 Chromium tests and the
Firefox 147.0.3 smoke suite passed, including the current RT TV hero fixture.
The live checker now asserts fixture years where supplied and records extracted
years and consent controls to clarify blocked outcomes.

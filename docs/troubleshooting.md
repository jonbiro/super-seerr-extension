# Troubleshooting Super Seerr

## The extension still shows an old version

Rebuild once, then reload the extension in `chrome://extensions`. Refresh Seerr and any external media pages so their content scripts are replaced. Confirm the loaded folder is `dist/chrome` from this checkout.

## Ratings or controls do not appear

- Save the correct server URL in Settings. An empty API key is allowed; an empty URL is not.
- Confirm the page uses that origin and path, and log into Seerr normally.
- Enable the relevant enhancement switches and click Save Settings.
- Try a discover/search grid or a movie/TV detail route. Unsupported routes and layouts may have no overlay.
- Some titles have no supported ratings or no sufficiently confident RT match; no badge can be correct behavior.

## Scores look wrong or uncertain

A tilde means an approximate RT match. Remakes and titles without a year are especially ambiguous. Check the underlying title and media type. Scores from different sources may update at different times. In-memory caches expire or reset when their execution context restarts; a service worker restart clears its RT cache.

For a reproducible issue, report title, year, movie/TV type, page route, extension version, and expected versus actual behavior. Do not share API keys or private server addresses in a public issue.

## Sorting does not affect every title

Only loaded cards in the grid associated with the controls are sorted. Unrated titles remain last. Other carousels and unloaded pages are not a server-side sorted catalogue. The order updates as ratings resolve; Reset restores original order and clears filters.

## Connection testing fails

Use the final HTTP(S) server URL, including any base path. Redirects, credentials embedded in the URL, queries, and fragments are rejected. Verify the API key in Seerr and check network access. Requests time out after ten seconds. The test uses the entered values without saving them; click Save Settings after a successful test.

For ratings-only use, save the URL without a key and use your logged-in Seerr session. The ON/RT toolbar badge indicates saved configuration, not a successful live health check.

## Bulk cancellation

Cancel or Escape stops future submissions. A request already sent to Seerr may still complete. Check Seerr’s request list before trying again. The extension does not bypass server approval or permission checks.

## Firefox fails to load

The current Firefox manifest retains a service-worker entry that Firefox does not support. This is a known blocker, not a problem with your server. See README for the pending compatibility change.

## Reporting a bug

Use https://github.com/jonbiro/super-seerr-extension/issues. Include browser and extension versions, the supported site/route, steps, and a sanitized screenshot or error. Debug helpers are under `window.seerr_debug` in the content-script execution context; inspect logs before sharing them because they may contain media or server response details.

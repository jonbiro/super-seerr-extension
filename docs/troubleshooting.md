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

If the toolbar shows “1/1 scored” above a list with many movies, reload Super Seerr version 3.1.9 or later in your browser’s extensions page, then refresh Seerr. Earlier builds targeted an individual list item instead of the complete list.

Only loaded cards in the grid associated with the controls are sorted. Unrated titles remain last. Other carousels and unloaded pages are not a server-side sorted catalogue. The order updates as ratings resolve; Reset restores original order and clears filters.

## Connection testing fails

Use the final HTTP(S) server URL, including any base path. Redirects, credentials embedded in the URL, queries, and fragments are rejected. Verify the API key in Seerr and check network access. Requests time out after ten seconds. The test uses the entered values without saving them; click Save Settings after a successful test.

For ratings-only use, save the URL without a key and use your logged-in Seerr session. The ON/RT toolbar badge indicates saved configuration, not a successful live health check.

## Bulk cancellation

Cancel or Escape stops future submissions. A request already sent to Seerr may still complete. Check Seerr’s request list before trying again. The extension does not bypass server approval or permission checks.

## Firefox fails to load

The Firefox manifest now uses the `background.scripts` module form that Firefox supports, but the package has not been exercised in a running Firefox. Treat Firefox as untested rather than supported. See README.

## The ratings overlay does not appear on Seerr

The site integrations and the Seerr overlay use different permissions. Open Settings: if a notice offers **Grant access**, the overlay has no permission to run on your server and cannot appear until you approve it. Changing the server URL asks again for the new origin, so re-saving after a move needs a fresh approval.

## A rating looks wrong or out of date

Cached ratings do not expire, so a score that has changed upstream keeps its stored value. The grid controls show when the loaded titles were cached; **Refresh scores** refetches just those. To drop everything, use **Settings → Troubleshooting → Clear ratings cache**, which open Seerr tabs pick up without a reload.

## Cards on a Seerr grid have no scores

Seerr does not put a card's link or title in the page until you hover it, so Super Seerr identifies cards from the title lists Seerr fetches for itself. If that is not reaching it, no badges appear and sorting has nothing to work with.

Open the browser console on a Seerr grid page and run:

```js
await superSeerrDiagnose()
```

That works in the console's default context. The same report is available as `seerr_debug.ratings.diagnose()`, but only after switching the console's context dropdown from `top` to **Super Seerr**, because the overlay runs in the extension's own world.

`observed.messages` is how many list responses were seen. Read it first:

- **`observed.messages` is 0** — nothing is being forwarded. Check that the page is your configured server, that Settings shows no **Grant access** notice, and reload: the observer installs at document start, so a tab opened before the extension was granted access will not have it.
- **`observed.messages` is above 0 but cards are unresolved** — read `unresolvedCards`. Each entry says why: `no observed title has this poster` means the list carrying that card was not among the responses seen, `more than one observed title has this poster` means resolving it would be a guess, and `nothing observed from the page yet` means the response has not arrived.
- **`observed.rejected` is above 0** — messages arrived in a shape that was refused. Worth reporting.

`listItems` is how many titles are known, and `cachedTitles` how many have scores stored.

## The API key is missing on another device

The server URL and overlay preferences sync across devices; the API key does not, because it is a secret held in device-local storage. Enter it once per device from Seerr Settings → General → API Key. Upgrading from a version that synced the key moves it to local storage on the device where it was saved.

## Reporting a bug

Use https://github.com/jonbiro/super-seerr-extension/issues. Include browser and extension versions, the supported site/route, steps, and a sanitized screenshot or error. Debug helpers are under `window.seerr_debug` in the content-script execution context. The background worker is quiet unless **Settings → Troubleshooting → Verbose logging** is on; turn it on to reproduce, then off again. Inspect logs before sharing them because they may contain media titles or server response details.

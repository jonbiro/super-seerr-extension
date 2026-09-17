# Super Seerr requirements and acceptance criteria

These criteria describe the current product contract. They replace the historical rename checklist. Examples and limitations in README remain part of the contract.

## Identity and configuration

- Product metadata, popup, options, and flyout use Super Seerr.
- Project links point to https://github.com/jonbiro/super-seerr-extension.
- Seerr and Jellyfin retain their names as external products.
- Required MIT attribution and historical settings migration remain intact.
- A saved server URL enables ratings-only mode; request actions additionally require an API key.
- The server URL and overlay preferences sync across devices; the API key is device-local and must be entered per device. An API key saved by an earlier version migrates out of sync storage on upgrade.
- The extension must not hold an all-sites host permission. Access to the Seerr origin is optional and requested when its URL is saved; declining still saves settings and surfaces a standing notice.
- Editing or testing settings must not save them. Save Settings applies connection values and overlay preferences together.
- Temporary connection tests must not alter the worker’s active connection.
- URLs must use HTTP(S) without embedded credentials, query strings, or fragments.

## Flyout

- Supported sites: IMDb, RT, TMDB, Letterboxd, Metacritic, Trakt, Filmweb.
- Letterboxd handles movies; other integrations support movies and TV where the site provides sufficient metadata.
- Extract identity through layered selectors and fallbacks; prefer explicit media IDs where available.
- Display request status and monitoring context. Use Jellyfin links supplied by Seerr for available media.
- Offer watchlisting for requestable media.
- Avoid duplicate flyouts and duplicate submissions during navigation or repeated clicks.

## Ratings

- Preserve partial bundles; never invent a missing score.
- Zero is valid. Invalid, out-of-range, or nonfinite numeric scores do not become displayable values.
- Separate movie and TV identities even when numeric IDs match.
- Earlier sources take precedence when fields overlap.
- RT scores below confidence threshold are hidden; accepted approximate matches show a tilde.
- Other rating sources cannot inflate RT confidence.
- Summary output is a single heuristic label or absent.
- Pending lookups coalesce; rejection allows retry; network work has a deadline.
- Bounded caches prevent indefinite accumulation during a browsing session.

## Overlay, sorting, and bulk requests

- Activate only on the configured Seerr origin/path and supported routes.
- Detect path and query changes, reject stale callbacks, and avoid duplicate elements.
- Keep request controls primary; ratings remain optional context.
- Provide saved switches for card badges, detail rows, summaries, sorting/filtering, and bulk selection.
- Sorting must work with badges hidden and update when scores arrive.
- Support critics/audience ascending and descending order; unrated cards stay last and ties retain original order.
- Reset clears filters and restores original order. Cleanup restores hidden cards.
- Confirm bulk selections before submission; missing ratings do not block valid identities.
- Support keyboard selection, dialog focus management, and cancellation of future batch requests.
- Escape user-controlled labels and retain Seerr’s own permission/approval handling.

## Build and release

- Parse source scripts and validate manifest paths before release.
- Keep tests passing, including actual production code executed against DOM and worker fixtures.
- Increment the patch version once per build invocation; use one version for combined browser outputs.
- Keep package metadata, lockfile, manifest, and README badge synchronized.
- Include the MIT license and exclude test/dependency directories from browser packages.
- Do not describe generated archives as signed, published, or browser-verified unless those checks occurred.

## Known limits

- The Firefox manifest uses the `background.scripts` module form, but has not been loaded in a running Firefox. Do not treat it as functional until that check happens.
- Ratings depend on RT markup, match heuristics, Seerr API responses, and the user’s session.
- Cards are identified from the title lists Seerr fetches for itself, because Seerr's markup withholds a card's link and title until it is hovered. A card whose poster matches no observed item stays unresolved rather than being guessed at.
- Cached ratings are bounded by entry count rather than age, and the two caches are capped independently. Both persist as a single rewritten blob, so a cap is also a write-size decision.
- Cached ratings do not expire. A score that changes upstream, or a title cached before some source was reachable, keeps its stored shape until the cache is cleared from Settings.
- Sorting covers loaded cards associated with the controls, not the complete catalogue or all carousels.
- Cards without explicit links require a unique matching list title. Ambiguous or missing metadata is left unresolved.
- Live validation across the seven external sites and a configured Seerr/Jellyfin instance is still needed before a store release.
- Whether an existing Chrome install retains its host permission when that permission moves from required to optional is expected but unverified; check an actual upgrade before a store release.

# Super Seerr requirements and acceptance criteria

These criteria describe the current product contract. They replace the historical rename checklist. Examples and limitations in README remain part of the contract.

## Identity and configuration

- Product metadata, popup, options, and flyout use Super Seerr.
- Project links point to https://github.com/jonbiro/super-seerr-extension.
- Seerr and Jellyfin retain their names as external products. Seerr means https://github.com/seerr-team/seerr, the unified successor to Overseerr and Jellyseerr; those predecessors share its API surface but are not what this is tested against.
- Required MIT attribution and historical settings migration remain intact.
- A saved server URL enables ratings-only mode; request actions additionally require an API key.
- Overlay preferences sync across devices. Legacy single-site URLs continue to sync until saved sites are used. Named/multiple connections and their active choice stay device-local with their individual API keys. Legacy API keys migrate out of sync storage on upgrade.
- Support up to ten saved Seerr sites, with one active site for requests and overlays. Preserve the existing connection when adding another. Reject stale requests after switching; never broadcast a request to multiple sites. Allow removal of inactive sites and keep confirmed history.
- The extension must not hold an all-sites host permission. Access to the Seerr origin is optional and requested when its URL is saved; declining still saves settings and surfaces a standing notice.
- Editing or testing settings must not save them. Save Settings applies connection values and overlay preferences together.
- Temporary connection tests must not alter the worker’s active connection.
- URLs must use HTTP(S) without embedded credentials, query strings, or fragments.

## Flyout

- Supported sites: IMDb, RT, TMDB, Letterboxd, Metacritic, Trakt, Filmweb, Simkl, JustWatch.
- Letterboxd handles movies; other integrations support movies and TV where the site provides sufficient metadata.
- Extract identity through layered selectors and fallbacks; prefer explicit media IDs where available.
- Display request status and monitoring context. Use the media-server links supplied by Seerr for available media, naming the server from its reported type and staying neutral when that is unknown.
- Offer Seerr watchlisting for requestable media.
- Offer Plex Universal Watchlist adds whenever a Plex token is configured, including for available media where the Seerr button hides. Resolve the Discover ratingKey by TMDB GUID when an id is known and refuse ambiguous title-only matches rather than guessing.
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

- The Firefox runtime harness covers permissions, overlay injection, SPA navigation, background reload, cache clearing and all nine supported-site synthetic fixtures. See the current handoff for its latest result. Authenticated live-site coverage and physical-device/browser compatibility remain open.
- Ratings depend on RT markup, match heuristics, Seerr API responses, and the user’s session.
- Cards are identified from the title lists Seerr fetches for itself, because Seerr's markup withholds a card's link and title until it is hovered. A card whose poster matches no observed item stays unresolved rather than being guessed at.
- Cached ratings are bounded by entry count rather than age, and the two caches are capped independently. Both persist as a single rewritten blob, so a cap is also a write-size decision.
- Cached scored bundles remain visible while aging results refresh: complete bundles after 24 hours, partial bundles after one hour. Unrated titles retry after six hours, and failed lookups after two minutes. Refresh scores and per-title retry bypass the normal freshness window.
- Sorting covers loaded cards associated with the controls, not the complete catalogue or all carousels.
- Cards without explicit links require a unique matching list title. Ambiguous or missing metadata is left unresolved.
- Live validation across the nine external sites and a configured Seerr/Jellyfin instance is still needed before a store release.
- Whether an existing Chrome install retains its host permission when that permission moves from required to optional is expected but unverified; check an actual upgrade before a store release.

## Tracker accounts

- Trakt and Simkl connections are optional, independent and device-local. Only trusted extension pages may configure or read account state. Never send credentials to discovery content scripts.
- Use public-client PKCE with exact callback and state validation; honor Simkl issuer validation. No client secret or account password entry.
- Explicit manual sync imports a bounded planned watchlist; it never writes to a tracker or automatically submits a Seerr request. Missing app registration or unavailable provider APIs must remain visible errors.
- Reject obsolete replies after disconnect or client changes, serialize refresh-token rotation, and keep source accounts separate from the selected Seerr destination.
- JustWatch discovery uses its public title pages and country-specific search, not its partner-only API.

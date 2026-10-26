# Chrome Web Store listing draft

Status: repository draft only. No approved listing, submission, store publication or signed distribution is claimed. See [release preparation](docs/releases.md).

## Listing copy

**Name:** Super Seerr

**Summary:** Request movies and TV from nine discovery sites, with ratings, filters and optional Trakt/Simkl watchlists for Seerr.

Super Seerr connects movie and TV discovery with your configured Seerr servers. Request titles from IMDb, TMDB, Letterboxd, Rotten Tomatoes, Metacritic, Trakt, Filmweb, Simkl and JustWatch. Review matching titles and TV seasons before requesting, switch between saved servers, and filter loaded Seerr titles using available ratings.

Optional Trakt and Simkl connections let you manually import a planned watchlist for review, then find individual titles in your active Seerr site. Each connection requires your own registered public application Client ID. Imports do not write to those services or automatically request titles. JustWatch links open a search in your selected streaming region; there is no JustWatch account connection or partner API access.

## Permission justifications

| Permission | Purpose |
| --- | --- |
| `storage` | Save settings, device-local credentials, bounded caches and user preferences. |
| `scripting` | Register Seerr overlays only for configured hosts after permission is granted. |
| `identity` | Open optional Trakt/Simkl authorization and receive the browser-generated callback. PKCE uses no client secret. |
| Required discovery hosts | Read title metadata and display request controls on the nine supported discovery services. |
| Optional HTTP/HTTPS hosts | Request access to the user's selected Seerr server and optional provider API hosts, when explicitly configured. |

## Privacy and data use

Source policy: [Data, storage and permissions](docs/privacy-and-permissions.md). Before submission, publish and verify the policy at the URL used in the store dashboard.

- API keys and OAuth tokens stay in local extension storage, outside browser preference sync. Content scripts receive public account/configuration state rather than credentials.
- Provider requests go directly to the selected service. No extension analytics or developer-operated collection endpoint is included.
- Title queries, IDs and requested seasons are sent as needed for the user's action. Optional tracker reads retrieve planned titles only when the user chooses Sync.
- Public rating caches remain separate from private server state and tracker account data. Disconnect removes local provider tokens; provider-side authorization is managed on the provider's website.
- No remote executable code is loaded. Dashboard privacy declarations must reflect all handled data, including authentication information and title activity; local storage alone does not remove disclosure requirements.

## Submission checklist

- Existing icons are under `icons/`; update listing screenshots to show the current flyout, filters and tracker Settings. Historical README screenshots are labeled as historical.
- Confirm publisher contact, category, distribution countries, policy URL and store-assigned extension ID in the publisher dashboard. These are not configured by this draft.
- Re-register the exact callback shown by the installed store build if its extension ID differs from the unpacked build.
- Verify live OAuth with registered Trakt and Simkl public apps. Automated fixtures do not establish provider acceptance.
- Resolve live-site access blocks and verify the published build before claiming full live coverage.
- Upload only a reviewed extension package; exclude this draft, development dependencies, tests and private files. Do not publish until the release gates in `docs/releases.md` are satisfied.

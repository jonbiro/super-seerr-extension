# Super Seerr verification workflow

## Before editing

1. Inspect `git status` and preserve unrelated user files.
2. Read the relevant implementation and [architecture](design.md).
3. Reproduce the issue or write a regression that exercises the production function or UI event.
4. Keep API/session fixtures free of real keys and private server data.

## Local checks

```sh
npm ci
npm run check
npm test
make build
```

`npm run check` parses runtime JavaScript and checks manifest paths. `npm test` includes model properties, messaging/storage behavior, actual worker code, DOM interaction, sorting, and temporary build/release tests. Some older tests are structural or simulated; new behavior should be verified through production code where practical.

`make build` increments the project version. Avoid rebuilding merely to repeat an unchanged check. Do not run independent Make processes concurrently in one checkout.

## Browser checks

1. Reload `dist/chrome` in `chrome://extensions` and refresh Seerr.
2. Save URL-only settings and confirm the RT toolbar badge and overlay.
3. Enable/disable each feature and save; confirm order and visibility reset cleanly.
4. Sort critics/audience scores, filter, reset, and load additional cards.
5. Navigate between searches, including query-only changes, then back/forward.
6. Test a new connection and confirm saved settings remain unchanged until Save.
7. With an authorized test server, review a bulk selection, submit, cancel, and verify only intended requests reached Seerr.
8. Check representative movie/TV pages on every supported external site and a Jellyfin link.

Use controlled test titles; real requests can trigger downloads. Local DOM fixtures cannot replace these browser/server checks.

## Package and publish

- `make release` creates a new version and zip/xpi files. Inspect names, manifests, source presence, and LICENSE.
- Firefox runtime remains blocked by its retained service-worker configuration. Do not publish it as compatible based on packaging tests.
- Commit only reviewed source/configuration/docs and intended artifacts.
- Push to `git@github.com:jonbiro/super-seerr-extension.git` when authorized, then verify the remote commit.
- Report exact test/build outcomes and outstanding live or signing checks.

## Follow-up work

- Resolve the Firefox manifest requirement and perform an actual Firefox load test.
- Validate current production Seerr layouts, especially separate carousels and cards without explicit links.
- Replace remaining simulated legacy tests with production-code regressions when those areas change.
- Validate cross-device sync of settings and reconnect behavior with a controlled server.

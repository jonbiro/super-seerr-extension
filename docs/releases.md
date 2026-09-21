# Release preparation

Run `npm ci`, `npm run check`, `npm test`, and `npm run test:browser` first.
Run the opt-in Firefox harness with Firefox/geckodriver when available.

`make release` increments the patch version once, builds both targets, and creates:

- `super-seerr-v<version>-chrome.zip` — Chrome Web Store upload package.
- `super-seerr-v<version>-firefox.xpi` — **unsigned** Firefox package.
- `super-seerr-v<version>-SHA256SUMS.txt` — archive checksums.

Commit the version metadata with the changes being released. A GitHub draft can
hold these artifacts for review; neither a draft nor an unsigned XPI is a store
release. The manually dispatched **Prepare release** workflow also runs checks,
builds packages and uploads downloadable workflow artifacts. Its Make build
increments the checked-out version, so inspect the resulting version before
signing/publishing and commit matching version metadata for any distributed build.
It does not automatically publish, push a commit, or change a store listing.

## Firefox signing

Mozilla signing requires credentials from the publisher's Mozilla account.
Configure `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` as repository secrets for the
manual workflow, or as environment variables for a local signing invocation.
Do not paste them into an issue, report or commit.

After `make release`, run:

```sh
node scripts/sign-firefox.cjs
```

The command checks that the prepared version and source match the checkout,
then invokes pinned `web-ext@10.6.0` with environment-provided credentials and
`--channel=unlisted`. Signed downloads go to `dist/signed-firefox`. This prepares
Firefox self-distribution; it does not create a public AMO listing or automatic
updates for a self-hosted release. Missing credentials cause a clear failure
before contacting Mozilla. See [Mozilla's signing instructions](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/#signing-your-extension-for-distribution).

## Chrome distribution

Chrome installation and automatic updates for ordinary users require an approved
Chrome Web Store item. Upload the prepared ZIP through the publisher dashboard,
complete the listing/privacy/test instructions, and submit for review. A locally
packaged CRX would not substitute for that distribution process. See
[Chrome publishing](https://developer.chrome.com/docs/webstore/publish/).

The repository had no configured signing secrets when this workflow was added.
Local checks and artifact generation are verified separately from signing,
store approval, and installation into a daily-use browser profile.

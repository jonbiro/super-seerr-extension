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
`--channel=unlisted`. Signed downloads go to `dist/signed-firefox`. The signing copy includes a stable GitHub Releases update-manifest URL. It does not create an AMO listing or publish the update feed. Missing credentials cause a clear failure
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


## Self-distributed Firefox updates

The signing script copies the verified Firefox build into
`dist/firefox-self-distributed` and adds this stable update URL before Mozilla
signs it: `https://github.com/jonbiro/super-seerr-extension/releases/latest/download/updates.json`.
The ordinary Firefox manifest remains suitable for a separate AMO submission.

After successful signing, pass the exact returned XPI to:

```sh
node scripts/prepare-firefox-updates.cjs /absolute/path/to/signed-addon.xpi
```

This checks the artifact ID/version and signature-file presence, then prepares
`dist/firefox-distribution/updates.json` with its exact SHA-256 and a versioned
signed XPI beside it. Signature-file presence is an accidental-input guard;
Firefox must still verify Mozilla's actual signature during installation.
The manual release workflow prepares these files automatically after signing.

Publication remains a separate gate: publish both files as assets of a public,
non-prerelease GitHub release tagged `v<version>`, marked as the latest release.
Verify that the stable update URL returns the JSON and its versioned XPI link
returns bytes matching the hash. Install a previously signed version in a clean
Firefox profile and verify an update through Firefox's Add-ons Manager. Do not
claim automatic updates are working until that end-to-end check passes.
Keep `updates.json` attached to every subsequent latest release; moving or
removing the stable URL strands installed versions.

Mozilla requires an HTTPS update manifest for self-distributed extensions;
see [Mozilla update documentation](https://extensionworkshop.com/documentation/manage/updating-your-extension/).

Credential check during this goal: local `WEB_EXT_API_KEY` and
`WEB_EXT_API_SECRET` were absent, and the repository secret list was empty.
No signed artifact, published update feed, or store release has been verified.

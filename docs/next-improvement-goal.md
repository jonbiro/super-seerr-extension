# Revised improvement goal

The active goal contains five requirements. VoiceOver testing is explicitly
excluded at the user's request and must not be enabled for this goal.

| Requirement | Implementation and verification |
| --- | --- |
| Safe presets across tabs | Worker serializes reads/writes, validates the sending Seerr page, recovers after failed writes; storage events synchronize controls. Worker tests and the two-tab Chromium regression pass. |
| Consistent diagnostics | Snapshot binds URL, credentials and settings generation; obsolete checks reject. Tests cover URL/key/token/reload changes and in-flight authentication. |
| Readable notifications | Production shared module pauses timers on hover/focus, keeps errors until dismissal, and protects focused notices during bursts. Chromium timer/focus/error regressions pass. |
| Saved-match management | Search covers titles, server, year, type and ID; details disclose each match's server and identity. DOM and Chromium tests cover search, details and individual deletion. |
| Signed-release preparation and update path | Signing copy has a stable HTTPS update URL; signer rejects stale source/manifest; update CLI checks identity/version and signature-file presence, copies exact artifact bytes, and generates a SHA-256 feed. Tests cover unsigned rejection, stale manifest and the CLI output. Manual CI workflow prepares these artifacts when publisher credentials are supplied. |

All implementation and local release-preparation work is complete. No claim is
made that an unsigned archive is signed or that the update feed is published.

## External signing and publication gates

- Both Mozilla environment variables are absent and the repository secret list
  is empty. Configure `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` securely before
  running signing; do not paste their values into the task.
- Actual signing requires Mozilla credentials. Publishing the signed XPI and
  `updates.json` to the configured release location and verifying a Firefox
  installed-version update remain external release gates. See `releases.md`.
- Update packaging tests use synthetic signature-file markers only to exercise
  local packaging. They do not prove Mozilla signature validity.

The earlier live-site audit is preserved in `live-site-results.json`: nine
passing cases, two access/consent blocks, and one unavailable page. VoiceOver was
restored to off and skipped; spoken announcements were not verified.

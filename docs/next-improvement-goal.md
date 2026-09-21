# Reliability, accessibility and distribution goal

This checklist tracks the seven-part improvement goal separately from earlier completed work.

- [x] Serialize filter preset read-modify-write operations in the worker; synchronize open controls through storage change events. Concurrent-tab and failed-write regressions cover the queue.
- [x] Run diagnostics against one settings snapshot and reject outdated reports. Added regressions for URL, credentials and settings reloads (3.5.28).
- [x] Pause notification dismissal on hover and keyboard focus; retain actionable errors longer.
- [x] Live regions are established before content updates (browser regression verified). VoiceOver verification was explicitly skipped at the user’s request.
- [x] Expand read-only live-site coverage to TV, navigation, localized titles and changing layouts; separate blocked sites from failures.
- [x] Add saved-match search, server labels and individual details.
- [ ] Signing and update-feed preparation implemented and tested; actual signing/publication and Firefox automatic-update verification require unavailable publisher credentials.

Local automated checks and unpacked builds do not establish screen-reader behavior, live-site compatibility, signing, store approval or publication. Record those outcomes separately when verified.

## Remaining verification gates

- VoiceOver is disabled, verified in macOS Accessibility settings. The user explicitly requested that VoiceOver testing be skipped; do not enable it again for this goal. Spoken announcements are not claimed as verified.
- Mozilla publisher credentials remain necessary for signing and testing an
  installed-version update. Configure `WEB_EXT_API_KEY` and
  `WEB_EXT_API_SECRET` as repository secrets or local environment variables;
  do not paste their values into the task. The existing release scripts stop
  before contacting Mozilla when they are absent.

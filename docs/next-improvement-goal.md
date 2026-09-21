# Reliability, accessibility and distribution goal

This checklist tracks the seven-part improvement goal separately from earlier completed work.

- [x] Serialize filter preset read-modify-write operations in the worker; synchronize open controls through storage change events. Concurrent-tab and failed-write regressions cover the queue.
- [x] Run diagnostics against one settings snapshot and reject outdated reports. Added regressions for URL, credentials and settings reloads (3.5.28).
- [x] Pause notification dismissal on hover and keyboard focus; retain actionable errors longer.
- [ ] Live regions are established before content updates (browser regression verified); VoiceOver announcement verification remains open.
- [ ] Expand read-only live-site coverage to TV, navigation, localized titles and changing layouts; separate blocked sites from failures.
- [x] Add saved-match search, server labels and individual details.
- [ ] Prepare signed release and automatic-update distribution, with explicit credential/publication gates.

Local automated checks and unpacked builds do not establish screen-reader behavior, live-site compatibility, signing, store approval or publication. Record those outcomes separately when verified.

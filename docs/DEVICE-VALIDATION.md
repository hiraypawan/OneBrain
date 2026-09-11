# Device validation — do not substitute a mic indicator for a working conversation

## Automated coverage in this change

| Environment | Evidence | What it does NOT establish |
|---|---|---|
| Headless Chromium desktop | Local capture/reload/links/completion/undo/settings pass | Real recognition or audible output |
| Chromium at 320/390/768/1440px widths | No page/map overflow at default zoom; zoom/pagination/capture tests pass | iOS WebKit behavior or physical-device touch testing |
| Simulated recognition + speech + clock | Idle wait, permission-first invitation, revoked consent, startup cancellation/unmount/recovery and old speech-timeout isolation pass | Bluetooth, battery behavior, actual spoken-language quality |

The current production build passed **20 browser tests**. See [UI and bug audit](UI-AND-BUG-AUDIT.md) for the detailed scope. Keyboard/dialog checks are targeted regressions, not a full accessibility audit.

## Physical device matrix — all unverified

Record the exact phone, OS, browser/PWA version, earbud model, network, and permission configuration for every run. Do not label a platform supported based on one short test.

For each situation, issue a new utterance and verify all four steps:
**speech → transcript → correct result/record → audible reply**.

- Foreground session, including mixed English/Hindi/Marathi and business names.
- Browser backgrounded without force-quitting.
- Screen locked for 5, 15, 30, and 60 minutes.
- Low-power/battery saver mode.
- Incoming call, completed call, and resumed session.
- Music playing on the same phone.
- Earbuds disconnected, reconnected, and switched to a second device.
- Wi-Fi changing to mobile data and fully offline operation.
- User stops from app, notification, and a spoken stop command.
- App force-quit: do not expect or advertise continued browser execution.
- Proactive mode off: no unsolicited invitations.
- Proactive mode on: no interruption during speech, quiet-hour suppression, permission before revealing history.
- No reply / “not now” / “stop asking”: no escalating or repeated nagging.
- Sensitive private response with earbuds removed: verify real routing; Silent Mode is the safe fallback until this is certified per device.

Also measure battery change, temperature, mic-ready latency, final-transcript latency, and time to confirmed action. A dark page is not an OS screen lock. Notifications and wake locks do not guarantee microphone execution.

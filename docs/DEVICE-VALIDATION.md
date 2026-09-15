# Device validation — do not substitute a mic indicator for a working conversation

## Automated coverage in this change

| Environment | Evidence | What it does NOT establish |
|---|---|---|
| Headless Chromium desktop | Local capture/reload/links/completion/undo/settings pass | Real recognition or audible output |
| Chromium at 320/390/768/1440px widths | No page/map overflow at default zoom; zoom/pagination/capture tests pass | iOS WebKit behavior or physical-device touch testing |
| Simulated recognition + speech + clock | Idle wait, permission-first invitation, revoked consent, startup cancellation/unmount/recovery and old speech-timeout isolation pass | Bluetooth, battery behavior, actual spoken-language quality |
| Unit tests for the audio path (`tts-route`, `tts-client`, `browser-speak`, `output-routing`) | Provider fallback chain, WAV wrapping, no host-key spending, cache keys, cancel/speak ordering, stall retry, automatic device resolution, pinned-device fallback | Real audibility, real Bluetooth routing, real lock-screen behavior |

The current production build passed **20 browser tests**. See [UI and bug audit](UI-AND-BUG-AUDIT.md) for the detailed scope. Keyboard/dialog checks are targeted regressions, not a full accessibility audit.

## Physical device matrix — all unverified

Record the exact phone, OS, browser/PWA version, earbud model, network, and permission configuration for every run. Do not label a platform supported based on one short test.

For each situation, issue a new utterance and verify all four steps:
**speech → transcript → correct result/record → audible reply**.

Replies are no longer spoken by the browser voice alone: audio bytes are played
through an `<audio>` element and routed automatically (see
[VOICE-OUTPUT.md](VOICE-OUTPUT.md)). Verify audibility on **each** output —
phone speaker, Bluetooth neckband, earbuds, desk speaker — including a mid-session
device switch and a locked screen.

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

## Media playback checks (reintroduced 2026-09-15) — all unverified

None of this was executed in the build sandbox, which had no network egress: **every keyless source must first be probed from the deployed workerd runtime** before any playback claim is made.

- “play &lt;song&gt;” while listening: search starts, the sticky player appears once (never two players), and audio actually starts.
- Autoplay blocked (iOS Safari first gesture, Android Chrome backgrounded tab): the player must say “tap play”, not show a silent “playing” state.
- A dead or rate-limited source: auto-advance to the next result, then a spoken refusal plus the YouTube search hand-off.
- “gaana band” / “phir se chalao” / “next song” / “stop song” versus bare “stop” and “continue”, which must still control the listening session.
- Ducking: a spoken reply lowers music and restores the previous volume afterwards; nothing stays ducked.
- Lock screen / earbud controls via the Media Session API: exactly one owner of metadata and action handlers.
- Bluetooth multipoint: start on the phone speaker, switch to earbuds mid-track, reconnect, and switch to a second device without double audio.
- Screen-off mode with music playing: battery drain and whether the browser suspends playback (browsers differ; do not promise background playback).
- Data cost and offline: a failed stream offline must not retry in a loop or burn mobile data.

## Entitlement and quota checks — all unverified

- Sign in on two devices, redeem one key on the first: the second device must show the same plan after its next `/bootstrap`, without a manual refresh hack.
- Exhaust a free quota (research or scribe) and confirm the `429` + `Retry-After` message names the bucket that refills, and that the client does not silently retry.
- Kill network access mid-session: the plan must persist for up to 24 hours, be labelled unverified, and must never silently upgrade or downgrade.
- Sign out: a server-granted plan must stop applying on that browser, and a browser-only unlock must be labelled as browser-only everywhere it appears.
- Confirm no UI string implies a purchase, invoice, renewal or refund — there is no payment path to support such a claim.

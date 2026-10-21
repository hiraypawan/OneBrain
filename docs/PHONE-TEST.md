# Phone test checklist (I have no devices — run through this on real phones)

## Setup
- [ ] Same Wi-Fi: run `run.bat` on PC, open `http://<PC-IP>:3000` on the phone
      (localhost on the phone is the phone itself — must use the PC's LAN IP).
- [ ] Optional backend: `cd backend; npm install; cp .env.example .env; npm run dev`,
      set `NEXT_PUBLIC_API_URL=http://<PC-IP>:5000` in `frontend/.env.local`, restart.

## Android Chrome
- [ ] Active → mic prompt → Listening; speak → text appears → voice answers in earbuds
- [ ] Notification "OneBrain Active" appears on minimize; tap returns; Stop ends session
- [ ] Earbud play/pause starts/stops; next repeats last answer
- [ ] Black-screen mode (/night): dim screen, mic keeps working while screen ON
- [ ] Refresh mid-chat → history intact; logout → login persists after refresh
- [ ] Reminder fires a notification at its time
- [ ] Add to Home Screen → standalone fullscreen icon

## iOS Safari
- [ ] Foreground Active works; keep app open for guaranteed listening
- [ ] Lock screen / minimize, talk after 60s: note whether it answered (varies by device — record iOS version!)
- [ ] Check Settings → Debug → Background session log for mic-muted/ended entries
- [ ] Add to Home Screen → opens standalone
- [ ] Voice answers route to AirPods when connected

## Report back per item: PASS / FAIL + what you saw (exact text/behavior).
## Known platform rules (not bugs): locked screen kills web mic on both OSes;
## Brave/Firefox have no voice recognition (typing fallback works).

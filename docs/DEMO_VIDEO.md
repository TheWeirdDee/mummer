# Demo video

A 1 minute 47 second video (cut from a 3 minute 27 second full recording to meet a two-minute limit) of the real app, recorded in a real Chromium window with captions drawn into the page and a voiceover from Windows' built-in speech engine (SAPI, voice "Microsoft David"). Nothing is simulated or composited: every screen is the app responding to real clicks.

## What it shows, and on what

It runs against the **staging** deployment (https://mummer-staging.mummer-app.workers.dev), which differs from production only in using Cloudflare's public Turnstile test keys (so the human check passes by itself) and its own database. A caption on every frame says "Demo data on a staging copy. No payment is made."

| Scene | What happens |
|---|---|
| Landing | The product in one sentence |
| Create | A host names an exchange and acknowledges the trusted-host draw |
| Human check | Turnstile with test keys; the narration says that on the real site a person completes it |
| Save the admin link | Paste-back check; keys live in the URL fragment |
| Join as Ada | Nickname, wishlist, wallet step; a **transparent address is refused** with a reason; a valid shielded address is accepted |
| Draw | The host reviews four people and draws; the host page shows no pairings |
| Assignment | Ada's recipient, wishlist, **QR**, address, amount and memo with copy buttons |
| Sent | "I sent it" with the dialog that says it is only the giver's word |
| Confirm | The recipient enters the memo reference; the dialog says it is their own word |
| Glass box | What the server stores: sealed blobs, sizes and fingerprints |
| Delete | The host deletes the exchange; everything is removed |
| End card | Live URL, repository, and what is **not** verified |

Three other people join in separate browser profiles while the window shows Ada joining; the window changes identity by clearing the app's site data, as a different person on another device would start with nothing.

## What it does not show (and says so)

- **No payment is made and no wallet is shown.** Real Zodl compatibility and real shielded payment execution are not verified, and the closing caption says so.
- **Reveal day is not shown.** It cannot be reached on a live deployment (the clock cannot be moved); the narration says it is covered by automated tests that move the clock.
- It is not a recording of the production site: production's real Turnstile challenge needs a person, so it cannot be automated.
- The addresses are public test vectors, not anyone's wallet. Do not send money to the QR in the video.

## Regenerate it

Needs Windows (for the voice), Chrome via Playwright, and ffmpeg with H.264 and AAC (Playwright's bundled ffmpeg is video-only and cannot mux audio; `pip install imageio-ffmpeg` in a throwaway virtual environment provides one).

```bash
DEMO_VIDEO=1 LIVE_URL=https://mummer-staging.mummer-app.workers.dev npx playwright test -c playwright.live.config.ts -g "demo video"
```

This writes `tests/e2e/.artifacts/demo/` (ignored by git): `mummer-demo-raw.webm`, `narration.wav` (each scene's speech laid at the scene's start time), `timeline.json`, and `zodl-scan-qr.png` plus `zodl-scan-details.txt` for the no-money wallet scan test (`ZODL_MANUAL_TEST.md`).

The recording starts before the first page has loaded, so about 7 seconds are blank. Replace them with the first real frame while muxing:

```bash
ffmpeg -i mummer-demo-raw.webm -i narration.wav \
  -filter_complex "[0:v]trim=start=7.0,setpts=PTS-STARTPTS,tpad=start_duration=7.0:start_mode=clone[v]" \
  -map "[v]" -map 1:a -c:v libx264 -crf 23 -pix_fmt yuv420p -r 25 -c:a aac -b:a 128k -movflags +faststart -shortest mummer-demo.mp4
```

Edit the scenes and their narration in `tests/live/demo-video.spec.ts`. The recorder deletes its own exchange at the end.

## The two-minute cut

The submission video is a cut of the same real recording: each scene's footage window is sped up where an action takes longer than its narration (typing, page loads), a few repeated scenes are dropped, and the narration was rewritten shorter and re-voiced with the same SAPI voice. Nothing is added that was not recorded. The cut was made with a throwaway script outside the repository (windows from `timeline.json`, one `ffmpeg` filter graph). The full-length version contains the narration for the scenes the cut drops.

## Upload

The MP4 is not in the repository (6 MB, generated). Upload it to the hackathon form or a video host of your choice, then paste the link into `docs/SUBMISSION.md`. A transcript with timestamps is generated from `timeline.json`.

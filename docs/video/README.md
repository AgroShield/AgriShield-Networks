# The pitch video

`docs/media/agrishield-demo-poster.jpg` links to a two-minute walkthrough of the
deployed system. The video is built from real artifacts rather than assembled by
hand, so it can be regenerated — and so every frame of it can be traced to
something in this repository.

The finished cut is attached to the [v1.0.0
release](https://github.com/AgroShield/AgriShield-Networks/releases/tag/v1.0.0)
rather than committed, because a video in git history is a video in every clone
forever.

## What it is built from

| Source | Where it comes from |
| --- | --- |
| Console footage | `capture.mjs` drives the **live** Vercel deployment with Playwright and records it |
| Console callout geometry | `probe.mjs` measures the real DOM, so highlights sit on the elements they name |
| Test evidence | `cargo test`, `pnpm test` and the fee tests, run against this tree |
| Contract proof | The testnet addresses and transaction in the README's [live deployment](../..#live-deployment) section |
| Graphic cards | `build-cards.mjs`, rendered in Chromium and checked to be within frame |
| Voice-over | `tts.mjs`, Gemini TTS, one clip per scene |

Nothing on screen is a mock-up and no number is invented. If a claim were not
true of the deployed system, the frame making it could not be captured.

## Requirements

- `ffmpeg` and `ffprobe` (the edit is ffmpeg filters throughout)
- Node 20+ and `playwright` with Chromium (`npx playwright install chromium`)
- Inter and JetBrains Mono installed — the console asks for `system-ui`, and a
  capture machine without a modern UI font substitutes a dated one
- `GEMINI_API_KEY` for the narration only

## Regenerating it

Each stage reads and writes under `WORKDIR`, which defaults to this directory.
Point it somewhere scratch to keep renders out of the tree.

```bash
cd docs/video
export WORKDIR=/tmp/agrishield-video
export CONSOLE_URL=https://frontend-eight-delta-o0pj7gck3j.vercel.app

node capture.mjs      # screenshots + a real interaction recording
node probe.mjs        # element geometry for the callouts
node build-cards.mjs  # graphic cards, plus half-size copies for the edit

export GEMINI_API_KEY=...   # TTS is rate limited on the free tier; re-runs skip cached clips
node tts.mjs

node assemble.mjs     # clips, crossfades, narration, export
```

`assemble.mjs` writes `out/agrishield-demo.mp4`. Scene lengths come from the
generated narration, so the pictures follow the voice rather than the other way
round — change the wording in `script.json` and the edit re-times itself.

Rendering is the slow part. Set `RESUME=1` to reuse clips that are already
complete; each is validated by duration first, because a killed encoder leaves a
file that exists but does not decode.

## How it is checked

The pipeline verifies itself rather than being eyeballed:

- every callout is asserted to land inside its frame, and images are checked for
  a non-zero natural size — which is how a `file://` origin problem and two
  misplaced highlights were caught;
- each rendered clip's duration is compared with its expected length before it is
  used, so a truncated encode cannot reach the edit;
- the finished file's speech is detected and compared against the timeline, which
  proves the narration landed in the right scenes and not merely that audio
  exists.

`script.json` holds the shot list and the narration. The timing note in it is the
point: `assemble.mjs` derives each scene's duration from the speech, so the
voice-over is the input and the visuals are the output.

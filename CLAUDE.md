# Reel Studio: instructions for Claude

Reel Studio is a local web app. A person drops a talking video into it, picks one of ten styles, picks fonts and
colours, and presses **Send to Claude**. You do the editing: transcribe, write the edit plan, render, check the result.
The person then downloads the finished video from the page.

Everything runs on their machine. Nothing is uploaded anywhere.

## If the person asks you to install or start it

1. Run `node scripts/setup.mjs`. It checks Node 18+, ffmpeg (with libass), and `uv` or Python.
2. Fix what it reports MISSING. Ask before installing system software. Typical commands:
   - Windows: `winget install Gyan.FFmpeg` and `winget install astral-sh.uv` (then open a new terminal)
   - macOS: `brew install ffmpeg uv`
   - Linux: `sudo apt install ffmpeg`, and `curl -LsSf https://astral.sh/uv/install.sh | sh`
3. Run `node scripts/setup.mjs --install-transcriber` once. It warms up the speech-to-text engine.
4. Start the app in the background: `node server.mjs --open`. It prints a `http://localhost:<port>` address
   (4173 unless taken). Tell the person to use that page. There are no npm packages to install.
5. Tell them: pick a video and a style, press **Send to Claude**, then come back and say "edit my reel".

If ffmpeg was installed in a place that is not on PATH, set `FFMPEG_DIR` to its folder.

## When the person says "edit my reel" (or presses Send to Claude)

Treat the job as the whole task. Work through these steps and report progress on the page as you go, because the page
shows what you write with `jobs.mjs status`.

1. **Find the job.** `node scripts/jobs.mjs next` prints the oldest submitted job as JSON. Read `settings`
   (style, fonts, colours, format, position, size, options) and `changes` (the person's own words, one request per
   line). If none is submitted, run `node scripts/jobs.mjs list` and ask which one.
2. **Say you started.** `node scripts/jobs.mjs status <id> working "Listening to your video" 10`
3. **Transcribe.** `node scripts/transcribe.mjs <id>` writes `jobs/<id>/words.json` (word-level timings). The default
   model is `small`. Use `node scripts/transcribe.mjs <id> medium` for accents or noisy audio, or `tiny` for a quick
   draft. Read the transcript and note any words it got wrong (names, brands, jargon).
4. **Look at the video.** `node scripts/frame.mjs <id> <seconds>` saves a still and prints its path. Read two or three
   stills (start, middle, end). Decide where the speaker's face and hands are, so captions never cover them.
5. **Write the edit plan** to `jobs/<id>/edit.json` (schema below). This is where your judgement matters most.
6. **Apply the person's requests.** Every line in `changes` must be reflected in `edit.json` or in `settings` inside
   `jobs/<id>/job.json` (for example "make the captions bigger" means `settings.captionSize = "big"`). If you cannot do
   one, say so plainly at the end instead of skipping it silently.
7. **Render.** `node scripts/render.mjs <id>` writes `jobs/<id>/output/reel-r<revision>.mp4` and sets the job to
   `done`. On failure it sets `error` with the reason and exits non-zero. Fix the cause and run it again.
8. **Check your work.** Extract frames from the finished video with `node scripts/frame.mjs <id> <seconds> output` at
   the title, a mid-caption moment, and a note if you added one. Read them. Confirm text is readable, off the face, and
   inside the frame. If something is wrong, fix `edit.json` and render again.
9. **Tell the person it is ready** and that they can download it on the page. Mention what you changed and anything you
   could not do.

If the person sends changes later (the page sets the job back to `submitted` with a higher `revision`), repeat from
step 1. You normally only need to redo steps 5 to 8, keeping the existing `words.json`.

### Optional: wait for jobs automatically

`node scripts/jobs.mjs wait` blocks until a job is submitted and then prints its id. Run it in the background if the
person wants you to start the moment they press the button.

## `edit.json` schema

All fields are optional. Times are seconds in the **original** video.

```json
{
  "title": { "line1": "How I edit", "accent": "yap videos", "duration": 3.6 },
  "captionPosition": "lower",
  "emphasis": ["Barcelona", "free"],
  "fixes": { "clawed": "Claude", "bar the lona": "Barcelona" },
  "cuts": [[12.4, 14.0]],
  "notes": [{ "text": "violinist in Barcelona", "at": 2.5, "duration": 3, "x": 0.7, "y": 0.34 }]
}
```

- **title**: write one even when the person did not. `line1` is a short lead-in (2 to 4 words). `accent` is the hook,
  shown large in the title font. Keep it honest to what the video says. If `settings.titleText` is set, use that as
  `accent`.
- **captionPosition**: `upper`, `middle` or `lower`. Only set it when the person left captions on "Auto" and the face
  or hands are where the style's default would put the captions. Never override a position the person chose.
- **emphasis**: the 3 to 8 words that carry the message. They are drawn in the accent colour.
- **fixes**: single-word corrections for the transcript, keyed by what was written. Multi-word fixes will not match, so
  for those edit the `text` fields in `words.json` directly.
- **cuts**: ranges to remove: false starts, repeated takes, dead air longer than the silence cutter catches.
  Never cut mid-word. Use the word timings. Silence cutting itself is a setting (`tightenSilences`) and needs nothing
  here.
- **notes**: sticker callouts (`x` and `y` are fractions of the frame). Use sparingly, 0 to 3, for facts like places,
  dates and numbers. Keep them off the face. Skip notes entirely if the person asked for a clean look.

## Settings you will see in `job.json`

`styleId`, `format` (`9x16`, `4x5`, `1x1`, `16x9`), `captionSize` (`small`, `medium`, `big`), `captionPosition`
(`auto`, `upper`, `middle`, `lower`), `fit` (`auto`, `fill`, `blur`), `captionFont` / `titleFont` / `noteFont` (ids from
`config/fonts.json`), `textColor` / `accentColor` (hex), `tightenSilences`, `normalizeAudio`, `titleText`.
A missing font or colour means "use the style's default".

## Where things live

- `config/styles.json`: the ten styles. `config/fonts.json`: the font list. `fonts/`: the font files (all SIL OFL).
- `lib/ass.mjs`: turns the plan into captions, title, notes, progress bar. `scripts/render.mjs`: the ffmpeg pipeline.
- `public/`: the web page. `server.mjs`: the local server.
- `jobs/<id>/`: one folder per video with `source.*`, `job.json`, `words.json`, `edit.json`, `captions.ass`, `output/`.
  This folder is git-ignored. Never commit or upload it.

## Adding a style or a font

- Style: add an object to `config/styles.json` (copy an existing one). It appears on the page automatically. Sizes are
  fractions of the 1080 px short side. Modes: `static`, `karaoke`, `pop`, `oneword`.
- Font: put a static `.ttf` in `fonts/`, keep its licence in `fonts/licenses/`, and add an entry to `config/fonts.json`
  (`family` must match the font's internal family name, set `bold` or `italic` to 1 only for those faces).

## Rules

- Never claim a render succeeded without the `Done:` line from `render.mjs`.
- Do not send the person's video, audio or transcript to any outside service.
- The server only listens on 127.0.0.1. Do not change that.

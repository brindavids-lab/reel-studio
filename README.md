# Reel Studio

Drop in a talking video, pick a look, choose your fonts, and hand it to Claude. Claude transcribes it, writes the
captions, cuts the dead air, adds a title, and gives you a finished reel to download.

Everything runs on your own computer. Your video is never uploaded anywhere.

- **10 styles**, each with its own fonts, layout, colours and caption animation
- **17 fonts** to mix in: title, captions and handwritten notes are chosen separately
- **4 formats**: 9:16 reel, 4:5 feed, 1:1 square, 16:9 wide
- **Live preview** with your own video before anything is rendered
- **Claude does the editing**: fixes transcript mistakes, picks the words to highlight, keeps captions off your face,
  adds a title and optional sticker notes, and checks the result

## Install (the easy way)

You need [Claude Code](https://claude.com/claude-code) (the desktop app, the CLI, or an IDE extension).

1. Download this repo: click **Code, Download ZIP** on GitHub and unzip it, or run `git clone <this repo's URL>`.
2. Open the folder in Claude Code.
3. Say: **"Install Reel Studio and start it."**

Claude checks your machine, installs what is missing (it asks first), and opens the page.

## Use it

1. **Video and style.** Drop your video on the page and click a style. The phone preview updates straight away.
2. **Fonts and layout.** Pick title, caption and notes fonts, text and accent colours, the format, the caption size and
   position. Write any extra requests, one per line. Press **Send to Claude**.
3. **Claude edits it.** Go back to Claude and say **"edit my reel"**. The page shows progress, then plays the result
   with a **Download video** button.
4. **Want changes?** Type them under the video and press **Send changes to Claude**, then say "edit my reel" again.

## The ten styles

| Style | Look | Main font |
| --- | --- | --- |
| Headline | Big uppercase captions, pop highlight, yellow accent. Tips and results | Anton |
| Scrapbook | Handwriting, paper notes, serif title. Lifestyle | Kalam |
| Signature | Soft italic serif, dates and travel. Personal brand | DM Serif Italic |
| Soft | Calm lowercase handwriting. Stories | Gaegu |
| Pop | Comic outlines, two words at a time. Fast and funny | Bangers |
| Neon | Cyan glow, pink highlight, vignette. Nightlife and tech | Bungee |
| Minimal | Clean subtitles in a quiet box | Poppins |
| Karaoke | Word-by-word green highlight in the middle of the frame | Poppins Black |
| Editorial | One huge word at a time, coral progress bar | Abril Fatface |
| Cinematic | Letterbox, teal and amber grade, film-poster type | Bebas Neue |

## Manual install (without asking Claude)

Requires Node 18+, ffmpeg (a build with libass), and either [`uv`](https://docs.astral.sh/uv/) or Python 3.9+.

```bash
node scripts/setup.mjs                        # checks everything and prints the fix for anything missing
node scripts/setup.mjs --install-transcriber  # one-time speech-to-text warm-up
node server.mjs --open                        # starts the page at http://localhost:4173
```

| | Windows | macOS | Linux |
| --- | --- | --- | --- |
| ffmpeg | `winget install Gyan.FFmpeg` | `brew install ffmpeg` | `sudo apt install ffmpeg` |
| uv | `winget install astral-sh.uv` | `brew install uv` | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |

Without `uv`, install the transcriber yourself: `pip install faster-whisper "av<17"`.

The first transcription downloads a speech model (about 500 MB for `small`). Set `REEL_WHISPER_MODEL=tiny` for a fast,
rougher draft or `medium` for the best accuracy.

## How it works

```
 browser page ──upload──▶ jobs/<id>/source.mp4
      │ "Send to Claude"
      ▼
 jobs/<id>/job.json  (style, fonts, colours, your requests)
      │ "edit my reel"
      ▼
 Claude:  transcribe.mjs ─▶ words.json
          look at frames, read transcript ─▶ edit.json (title, emphasis, fixes, cuts, notes)
          render.mjs ─▶ ffmpeg + subtitles ─▶ jobs/<id>/output/reel-rN.mp4
      ▼
 browser page plays it and offers the download
```

The captions, title card, sticker notes, progress bar and letterbox are drawn by ffmpeg's `subtitles` filter from a
generated `.ass` file, using the same font files the preview uses, so what you see is what you get.

Folder map: `config/` (styles and fonts), `fonts/`, `lib/`, `scripts/`, `public/` (the page), `server.mjs`, `CLAUDE.md`
(Claude's instructions), `jobs/` (your videos and results, ignored by git).

## Add your own style or font

Copy a block in `config/styles.json` and change it, or drop a `.ttf` into `fonts/` and add a line to
`config/fonts.json`. Both show up on the page after a refresh. You can also just ask Claude to do it.

## Privacy and safety

- The server listens on `127.0.0.1` only and refuses requests from other sites and hostnames.
- Transcription runs locally with [faster-whisper](https://github.com/SYSTRAN/faster-whisper).
- `jobs/` holds your videos. It is in `.gitignore`. Do not commit it.

## Limits

- Face avoidance is judgement, not face detection: Claude looks at a few frames and picks upper, middle or lower
  captions. Check the result and ask for a change if it is off.
- The browser preview approximates the render (CSS versus ffmpeg), so small differences in spacing are normal.
- Transcripts are best in clear speech. Names and jargon may need fixes, which Claude makes from context.

## Credits and licences

Code: MIT, see [LICENSE](LICENSE). Fonts: SIL Open Font License 1.1 from [Google Fonts](https://fonts.google.com),
licences in [fonts/licenses](fonts/licenses). Reel Studio is an independent project and is not affiliated with or
endorsed by Anthropic or Instagram.

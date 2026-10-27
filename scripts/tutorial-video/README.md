# Tutorial video generator

Rebuilds `docs/video/discrello-tutorial.en.mp4` (and the `.srt` captions) after UI changes.

It starts the built server in demo mode (in-memory fake Discord and Trello, PGlite database), drives
the UI in headless Chrome with a visible cursor, narrates each scene with the offline
[Piper](https://github.com/rhasspy/piper) voice `en_US-lessac-medium`, burns in captions and
assembles a 1080p MP4. Nothing touches a real Discord server, Trello board or Supabase database.

## One-time setup (Linux x86_64, Google Chrome installed)

```bash
cd scripts/tutorial-video
npm install                      # ffmpeg-static + puppeteer-core, kept out of the workspace

mkdir -p piper && cd piper
curl -L -o piper.tgz https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz
tar xzf piper.tgz
curl -L -o en_US-lessac-medium.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx
curl -L -o en_US-lessac-medium.onnx.json \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json
cd ..
```

## Build

```bash
pnpm -C ../.. build              # the video records the built app
npm run build-video              # ~6 minutes; port 3987 must be free
cp out/discrello-tutorial.en.mp4 out/discrello-tutorial.en.srt ../../docs/video/
```

The narration and the actions of every scene are in the `scenes` and `actions` objects of
`make-video.mjs`. Each scene is recorded for as long as its narration lasts.
`CHROME_PATH`, `PIPER_BIN` and `PIPER_VOICE` override the default paths.

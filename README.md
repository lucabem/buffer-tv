# 🎬 BufferTV

A desktop IPTV player with a **delayed buffer**. Instead of playing a live stream the moment it arrives, BufferTV records it to disk for a few minutes first and only then opens the video window. When the provider stalls (bitrate drops to zero, frozen picture, reconnects), the stall happens inside the buffer, and playback keeps going smoothly.

Built with **Electron + TypeScript**, no UI framework. The original Python/Tkinter version is kept in [`legacy-python/`](legacy-python/) for reference.

> **Disclaimer:** BufferTV is a player only. It does not include, host, or recommend any channel list or content. You must provide your own legitimate IPTV service URL.

## Contents

- [Features](#features)
- [How the buffer works](#how-the-buffer-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration and data files](#configuration-and-data-files)
- [Development](#development)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)

## Features

- **Delayed playback** with a configurable delay (in seconds) and buffer size (in MB), set per server.
- **Live channel browser** with categories, favourites, search (`/`), and recently played channels.
- **Quality detection** with `ffprobe`: real resolution, codec, and frame rate, not the name shown in the playlist.
- **Quality selector**: when a channel has several variants (e.g. `HD`, `4K`), the app recommends the one with the highest measured resolution.
- **Live status**: buffer fill level, download rate, connection health, and reconnect count.
- **Automatic reconnection** with exponential backoff (1 s up to 20 s).
- **VOD catalogue** (movies and series) with search (minimum 3 characters). Plays directly, without buffering.
- **TV guide (EPG)** for the selected channel, in XMLTV format.
- **Logo cache** for channel and programme artwork.
- **Multiple servers**, each with its own URL, delay, and buffer settings.

## How the buffer works

```
IPTV server ──► ffmpeg (-c copy, no re-encoding) ──► stream.ts on disk ──► ffplay
                       │                                    ▲
                       │ reconnect with backoff             │ cleaned up when
                       ▼                                    │ total size exceeds the limit
                 health monitor (every 2 s)  ───────────────┘
```

1. **Probe:** before capturing, the app records 3 seconds of the stream to estimate bitrate and check that data is flowing. It then runs `ffprobe` to read the video stream's properties.
2. **Capture:** `ffmpeg` copies the stream without re-encoding into `$TMPDIR/iptv-buffer/stream.ts`. If the connection drops, it reconnects with a backoff.
3. **Playback:** once at least **50 MB** has accumulated, `ffplay` opens and reads the same file while it is still being written.
4. **Cleanup:** when the total size of `.ts` files exceeds the configured buffer, the oldest files are deleted until usage falls below 80% of the limit. The file currently being written is never deleted.

The delay you see is roughly `buffer_mb / download_rate`. The status bar shows this estimate as the time the video is behind live.

## Requirements

- **macOS** (tested) or **Linux** (not yet tested; should work, see below).
- **Node.js 20** or newer.
- **ffmpeg** with `ffprobe` and `ffplay`:
  - macOS: `brew install ffmpeg`
  - Debian/Ubuntu: `sudo apt install ffmpeg`
  - Fedora: `sudo dnf install ffmpeg` (may require RPM Fusion)
  - Arch: `sudo pacman -S ffmpeg`

  The app looks for the tools in your `PATH` and also in `/opt/homebrew/bin` and `/usr/local/bin`.
- An IPTV service that provides an **M3U playlist URL** in the form `http://host/…/gets.php?user=USER&pass=PASS`.

## Installation

```bash
git clone <repository-url> iptv-buffer
cd iptv-buffer
./install.sh   # checks ffmpeg, installs npm dependencies, downloads Electron, builds the app
./run.sh       # builds and launches BufferTV from the terminal
```

### Standalone macOS app

To get a double-clickable app:

```bash
./build_app.sh
```

This creates `BufferTV.app` in the project root. You can open it from Finder or move it to `/Applications`.

> **Note:** the app bundle contains the absolute path of the project. If you move the project folder, run `./build_app.sh` again.
> The bundle is ad-hoc signed. On another Mac, Gatekeeper will ask you to confirm it the first time (right-click → Open).
> Logs for the bundled app are written to `~/Library/Logs/BufferTV.log`.

## Usage

1. Click **+** in the sidebar and enter a name and the full playlist URL, including `user` and `pass`. The server is checked before it is saved.
2. Select the server and click **Load channels**. Channels are cached for 30 minutes.
3. Filter with **All**, **Football**, **M+ & DAZN**, or **⭐ Favourites**, or search with `/`.
4. Click a channel. If it has several quality variants, a selector opens, showing the measured resolution.
5. Adjust the **delay** and **buffer** in the bottom bar, then press **▶**.
6. BufferTV tests the channel, starts capturing in the background, and opens the video window when enough is buffered.

Use the **Movies & series** tab for VOD content. It plays directly, without the delayed buffer.

Use the **Programme guide** button to see today's schedule for the selected channel.

## Configuration and data files

BufferTV uses the same paths as the Python version, so saved servers and caches carry over.

| What | Where |
|---|---|
| Configuration | `~/.config/iptv-buffer/config.json` |
| Playlist cache | `~/.cache/iptv-buffer/playlists/` |
| Logo cache | `~/.cache/iptv-buffer/logos/` |
| EPG (TV guide) cache | `~/.cache/iptv-buffer/epg/` |
| Video buffer | `$TMPDIR/iptv-buffer/stream.ts` |

The configuration file has this structure:

```json
{
  "servers": [
    {
      "name": "My provider",
      "url": "http://host.example/s/gets.php?user=USER&pass=PASS&t=m3uplus&o=mpegts",
      "delay_seconds": 300,
      "buffer_mb": 500,
      "enabled": true
    }
  ],
  "defaults": { "delay_seconds": 300, "buffer_mb": 500 },
  "favorites": { "My provider": ["Channel A", "Channel B"] },
  "last_played": { "My provider": "Channel A" },
  "last_server": "My provider"
}
```

Credentials are stored in plain text in this file. Keep it private.

Special characters in passwords (`&`, `+`, `%`) are URL-encoded automatically when the playlist URL is built.

## Development

```bash
npm run dev         # build and launch Electron
npm run build       # bundle the app into dist/ with esbuild
npm run typecheck   # TypeScript check without emitting files
npm test            # run the test suite with Vitest
```

The test suite covers the M3U parser, the playlist URL builder, the EPG parser, the buffer cleanup logic, ffprobe output parsing, the quality recommendation, channel grouping, and the configuration loader.

## Project structure

```
src/
├── core/        Node logic with no UI: player, probe, playlist, m3u, epg,
│                logos, cache, config, filters, grouping, rate, format
├── main/        Electron main process: window, IPC handlers, preload script
├── renderer/    User interface: HTML, CSS, and TypeScript without a framework
└── shared/      IPC contract shared between main and renderer
tests/           Vitest test suite
scripts/         Build script (esbuild)
legacy-python/   Original Python/Tkinter version, kept for reference
install.sh       Dependency check and build
run.sh           Build and launch from the terminal
build_app.sh     Generates the standalone BufferTV.app bundle
```

## Troubleshooting

**The `.app` exits with `env: node: No such file or directory`** (exit code 127)
Finder does not inherit your terminal's `PATH`. `build_app.sh` exports the Homebrew paths in the launcher. Regenerate the bundle if you built it with an older version.

**"Missing dependencies" or ffmpeg not found**
Run `brew install ffmpeg`, then check that `which ffmpeg ffprobe ffplay` returns a path.

**The channel says it is unstable**
The app plays it anyway. Small test sizes usually mean the server is slow or the channel is offline.

**The buffer never reaches 50 MB**
Check the **Reconnecting** status and the log. A low download rate means the playback will start late.

**Logs**
- Terminal launch: output goes to the terminal.
- Bundled app: `~/Library/Logs/BufferTV.log`.

## Limitations

- **Probed quality is what the stream reports.** BufferTV does not decode the video, so it cannot detect dropped frames or packet loss.
- **`avg_frame_rate` is an average** and can differ from the instantaneous frame rate.
- **The bitrate from the 3-second test is an estimate.** Connection start-up bursts can skew it.
- **The health indicator only means data is arriving.** It does not verify the picture is correct.
- **Each channel opens three connections to the server** (probe, test, and capture). Some providers limit concurrent connections.
- **macOS only** has been tested.
- **No App Store distribution.** The app depends on Homebrew binaries and a project-relative launcher, so it is not packaged for sandboxed distribution.

## License

Copyright (C) 2026 lucabem.

BufferTV is free software: you can redistribute it and/or modify it under the terms of the [GNU General Public License](LICENSE) as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

BufferTV is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

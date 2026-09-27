# My Player

A private music player for your own songs. Your music stays in a private Google Drive folder and streams straight from there. There are no passwords or secrets in this code: to hear anything you have to sign in with the Google account that owns the folder.

## Features

- Albums, songs and artists built from the tags inside your files
- Full technical info: codec, sample rate, bit depth, real bitrate, VBR/CBR, LAME preset, FLAC MD5, ReplayGain, MusicBrainz IDs, embedded artwork and every raw tag
- Synced lyrics from `.lrc` files, ID3 SYLT frames, or LRC timestamps inside the lyrics tag (word-by-word for enhanced LRC)
- Colors taken from the album art, full-screen Now Playing, lock-screen and headphone controls
- Upload songs, `.lrc` files and covers to your Drive from the app (drag and drop works too)
- Settings: music folder, ReplayGain volume normalization, display options, storage, log out
- Installable on your phone's home screen

Supported audio: FLAC, MP3, M4A (AAC/ALAC), WAV, OGG Vorbis, Opus.

## Organizing your Drive folder

- Each sub-folder becomes an album (tags win when present).
- Put `cover.jpg` in a folder, or embed artwork in the files, for album covers.
- For synced lyrics, add a `.lrc` file with the same name as the song, e.g. `03 Song.flac` + `03 Song.lrc`.

## Configuration

[`config.js`](config.js):
- `googleClientId`: your Google Cloud OAuth Client ID
- `driveFolderId`: the default music folder (can be changed in Settings)

## Test on your PC

Double-click `serve.bat`, then open http://localhost:8080. Needs Python.

## Google Cloud setup

Google Auth Platform → Clients → your client → **Authorised JavaScript origins** must include:
- `http://localhost:8080` (local testing)
- `https://nucant.github.io` (GitHub Pages)

Audience → Test users must include your Gmail. The Google Drive API must be enabled.

Uploading asks once for permission to add files to your Drive; normal playback only uses read-only access.

## Files

| File | Purpose |
|---|---|
| `index.html`, `style.css` | Screens and design |
| `app.js` | UI: library, Now Playing, sheets, settings, upload |
| `js/auth.js` | Google sign-in |
| `js/drive.js` | Drive API: list, read, upload |
| `js/meta.js` | Tag and audio-format parser |
| `js/library.js` | Folder scan → albums, songs, artists |
| `js/lyrics.js` | LRC / SYLT lyrics and syncing |
| `js/covers.js` | Cover loading and color extraction |
| `js/player.js` | Playback, queue, shuffle, repeat, lock screen |
| `js/settings.js`, `js/store.js` | Settings and on-device cache |
| `sw.js` | Streaming with seek support, offline app shell |

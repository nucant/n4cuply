# N4cuply

A private music player for your own songs. Your music stays in a private Google Drive folder and streams straight from there. There are no passwords or secrets in this code: to hear anything you have to sign in with the Google account that owns the folder.

## Features

- Albums, songs and artists built from the tags inside your files
- Full technical info: codec, sample rate, bit depth, real bitrate, VBR/CBR, LAME preset, FLAC MD5, ReplayGain, MusicBrainz IDs, embedded artwork and every raw tag
- Synced lyrics from `.lrc` files, ID3 SYLT frames, or LRC timestamps inside the lyrics tag (word-by-word for enhanced LRC)
- Colors taken from the album art, full-screen Now Playing, lock-screen and headphone controls
- Upload songs, `.lrc` files and covers to your Drive from the app (drag and drop works too)
- Multiple sources: the default Drive folder plus up to 5 more (other folders, other Google accounts, or folders on your PC)
- PC folders (Chrome/Edge on a computer) are picked once and remembered; the same song in Drive and on the PC shows once and plays from the PC
- Settings: sources, ReplayGain volume normalization, display options, storage, accounts, log out
- Liked songs and playlists (synced to your other devices through your Drive)
- Song menu: play next, add to queue, add to playlist, go to album/artist, fix, edit, info
- Crossfade (0–12 s) with gapless hand-over between songs, and a sleep timer that fades out
- Home shelves: recently played, most played, recently added
- Fix info & cover (✨) from Apple iTunes, manual Edit info, and saving tags + cover into FLAC/MP3 files (audio untouched, verified before saving)
- Organize: merge duplicate artists and split albums, find missing covers and lyrics
- Artist profiles with photo and bio from Wikipedia
- Audio analysis: spectrogram, lossless check (spots FLACs made from MP3s and fake Hi-Res), peak, loudness, dynamic range, clipping
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

Audience → Test users must include every Gmail you sign in with (each extra account too). The Google Drive API must be enabled.

Uploading asks once for permission to add files to your Drive; normal playback only uses read-only access.

## Family accounts

Family members sign in with a username and password, no Google account, and can only listen. The admin (`adminEmail` in `config.js`) signs in with Google as before and manages them in `admin.html` (Settings → Family members): approve requests, add people, turn accounts off, set new passwords.

The server is a Cloudflare Worker in [`server/`](server/) with a D1 database (`schema.sql`). Passwords are stored only as PBKDF2 hashes. It reads the admin's Drive for family members, read-only and only inside the music folder.

One-time setup:
1. Google Auth Platform → Clients → your client → **Authorised redirect URIs**: add `https://n4cuply-api.nucant.workers.dev/auth/google/callback`.
2. Copy the client's **Client secret**, then in `server/`: `npx wrangler secret put GOOGLE_CLIENT_SECRET` and paste it (it never goes in the code).
3. Google Auth Platform → Audience → **Publish app**. In Testing mode Google ends the Drive link after 7 days.
4. Open `admin.html` → **Link Drive**.

Deploy server changes with `npx wrangler deploy` in `server/`.

## Files

| File | Purpose |
|---|---|
| `index.html`, `style.css` | Screens and design |
| `app.js` | UI: library, Now Playing, sheets, settings, upload |
| `js/auth.js` | Google sign-in |
| `js/family.js`, `admin.html` | Family sign-in and the admin portal |
| `server/` | Family server (Cloudflare Worker + D1) |
| `js/drive.js` | Drive API: list, read, upload |
| `js/meta.js` | Tag and audio-format parser |
| `js/sources.js` | Drive and PC sources, reading files from either |
| `js/library.js` | Source scan → albums, songs, artists |
| `js/lyrics.js` | LRC / SYLT lyrics and syncing |
| `js/covers.js` | Cover loading and color extraction |
| `js/player.js` | Playback, queue, shuffle, repeat, lock screen |
| `js/settings.js`, `js/store.js` | Settings and on-device cache |
| `js/organize.js` | Library clean-up rules, likes and playlists (synced as n4cuply-library.json) |
| `js/online.js` | Optional lookups: iTunes (info, covers), LRCLIB (lyrics) |
| `js/artists.js` | Artist photos and bios from Wikipedia |
| `js/tagwrite.js` | Writing tags and covers into FLAC and MP3 files |
| `js/analyze.js` | Spectrogram and lossless check |
| `sw.js` | Streaming with seek support, offline app shell |

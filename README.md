# My Player

Nijer gaan shonar jonno private music player. Gaan thake Google Drive-er ekta private folder-e, app sekhan theke sorasori stream kore. Code-e kono password ba secret nei; gaan shunte tomar Google login lagbe.

## Kivabe kaaj kore

1. App khulle "Google diye connect koro"
2. Google-e login, Drive read-only permission "Allow"
3. Drive folder-er prottek sub-folder ekta album hisebe dekhay
4. Folder-e `cover.jpg` (ba je kono chobi) rakhle seta album cover hoy

Supported: mp3, m4a, aac, wav, ogg, opus, flac, webm.

## Settings

[`config.js`](config.js)-e:
- `googleClientId`: Google Cloud-er OAuth Client ID
- `driveFolderId`: gaaner folder-er ID (folder link-er sesh ongsho)

## PC-te test

`serve.bat` double-click koro, tarpor http://localhost:8080 kholo. Python lagbe.

## Google Cloud setting

Google Auth Platform → Clients → tomar client → **Authorised JavaScript origins**-e egulo thakte hobe:
- `http://localhost:8080` (PC test)
- `https://nucant.github.io` (GitHub Pages)

Audience → Test users-e tomar Gmail thakte hobe.

## Files

| File | Kaaj |
|---|---|
| `index.html`, `style.css` | App-er screen ar design |
| `app.js` | Screen, button, search |
| `js/auth.js` | Google login |
| `js/drive.js` | Drive API |
| `js/library.js` | Folder scan → album → gaan |
| `js/player.js` | Play, queue, shuffle, repeat, lock screen |
| `sw.js` | Stream (seek soho) ar offline app shell |

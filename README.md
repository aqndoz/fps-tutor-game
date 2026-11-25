# Tactical 1v1 (static site)

Status: **stage 1 of 8** - map registry, pointer lock, movement, stances, sprint-stands-up, collision.
`index.html` (guest) and `admin.html` (host) both start a local practice session for now; codes, PeerJS, weapons, destruction, bomb and questions come in later stages.

## Run locally
ES modules need http, not file://: run `python3 -m http.server` in this folder and open `http://localhost:8000/admin.html`.
Add `?map=<id>` to pick a map.

## Deploy to GitHub Pages
Push all files to a repo, then Settings > Pages > deploy from the main branch, root folder. Edit `config.js` first (password, room id).

## Add a map
1. Copy `maps/_template.js` to `maps/mymap.js` and draw your map (legend is in the file).
2. Add `import mymap from "./mymap.js";` to `maps/index.js`.
3. Add `mymap` to the `MAPS` array there. It appears in the admin dropdown automatically.
The validator logs a `console.warn` for a missing spawn or bomb site, uneven rows or unknown characters.

## Notes
- The shipped house map is ground floor only for now; the second storey and stairs arrive with the vault/stairs stage.
- Three.js is pinned to 0.160.0 via jsDelivr.

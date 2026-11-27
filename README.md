# Tactical 1v1 (static site)

Status: **stages 1-7 of 8** - movement, stances, vaulting, 5 weapons, destructible cell walls with barricade groups, impact grenades, PeerJS 1v1 with one-time codes, bomb rounds (first to 5) and the question gate.
Not built yet: loadouts, attachments, scopes, settings and the office map (stage 8).

## Play
1. Edit `config.js`, deploy (below), open `admin.html`, enter the password, press "New access code".
2. Send the code to your guest; they open `index.html`, enter it and press Join.
3. Pick a map (or Random) and press "Start match". Starting without a guest is a solo test.
Controls: WASD, Space vault (only at crates and window sills; there is no jumping), Shift sprint, C crouch, X prone, Q/E lean (toggle, works while aiming), LMB fire, RMB aim, R reload, 1-5 weapons, V knife, hold G for the grenade preview and release to throw, hold F to plant (3 s) or defuse (5 s).

## Questions
In `admin.html` add questions (text plus accepted answers separated by `|`, case-insensitive), set the interval and the answer time, and use Export/Import JSON to back them up. The guest answers one before every spawn and every N minutes of match time (the match pauses for both players). A wrong answer or a timeout gives a new random question; a correct one gives +3 magazines of reserve for every weapon. With no questions saved, nobody is asked.

## Run locally
ES modules need http, not file://: run `python3 -m http.server` in this folder and open `http://localhost:8000/admin.html`.
Add `?map=<id>` to pick a map.

## Deploy to GitHub Pages
Push all files to a repo, then Settings > Pages > deploy from the main branch, root folder. Edit `config.js` first (password, room id).

## Add a map
1. Copy `maps/_template.js` to `maps/mymap.js` and draw your map (the legend is in the file).
2. Add `import mymap from "./mymap.js";` to `maps/index.js`.
3. Add `mymap` to the `MAPS` array there. It appears in the admin dropdown automatically.
Every character is a 0.25 m cell, so walls are thin and made of many small cells. Every map needs two floors. Each round the attacker starts at a `1` outside the building; the defender starts in a random room marked with `S` and the attacker must plant there. Stairs are runs of `^ v < >` (12 in a row = one floor; the floor above needs a void over them).
The validator logs a `console.warn` for a single-floor map, a missing `1` or `S`, uneven rows or unknown characters.

## Notes
- PeerJS uses its free public signalling server and Google STUN; very strict networks may need a TURN server.
- Hit/removal counters for reinforced cells and barricades are kept per machine; the removed-cell lists are what keeps both screens in sync.
- The opponent's grenade flight is not drawn; they see the explosion.
- Hit/removal counters are per machine; doors and windows are frames (indestructible) around barricade groups.
- The shipped house map is ground floor only for now; the second storey and stairs arrive with the vault/stairs stage.
- Three.js is pinned to 0.160.0 via jsDelivr.

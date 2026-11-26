# Tactical 1v1 (static site)

Status: **stages 1-6 of 8** - movement, stances, vaulting, 5 weapons (semi/full auto, recoil, ADS, reload, lean, knife), cell-by-cell destructible walls with barricade groups, impact grenades with throw preview, PeerJS 1v1 with one-time codes, 10 Hz state sync, footstep indicator, bomb plant/defuse rounds (first to 5).
Not built yet: question gate and ammo rewards (stage 7); loadouts, attachments, scopes, settings and the office map (stage 8).

## Play
1. Edit `config.js`, deploy (below), open `admin.html`, enter the password, press "New access code".
2. Send the code to your guest; they open `index.html`, enter it and press Join.
3. Pick a map (or Random) and press "Start match". Starting without a guest is a solo test.
Controls: WASD, Space jump/vault, Shift sprint, C crouch, X prone, Q/E lean (hold), LMB fire, RMB aim, R reload, 1-5 weapons, V knife, hold G for the grenade preview and release to throw, hold F to plant (3 s) or defuse (5 s).

## Run locally
ES modules need http, not file://: run `python3 -m http.server` in this folder and open `http://localhost:8000/admin.html`.
Add `?map=<id>` to pick a map.

## Deploy to GitHub Pages
Push all files to a repo, then Settings > Pages > deploy from the main branch, root folder. Edit `config.js` first (password, room id).

## Add a map
1. Copy `maps/_template.js` to `maps/mymap.js` and draw your map (the legend is in the file).
2. Add `import mymap from "./mymap.js";` to `maps/index.js`.
3. Add `mymap` to the `MAPS` array there. It appears in the admin dropdown automatically.
Every character is a 0.5 m cell, so walls are thin and made of many small cells. Each round the attacker starts at a `1` outside; the defender starts in a random room marked with `S` and the attacker must plant there. Stairs are runs of `^ v < >` (6 in a row = one floor; the floor above needs a void over them).
The validator logs a `console.warn` for a missing `1` or `S`, uneven rows or unknown characters.

## Notes
- PeerJS uses its free public signalling server and Google STUN; very strict networks may need a TURN server.
- Hit/removal counters for reinforced cells and barricades are kept per machine; the removed-cell lists are what keeps both screens in sync.
- The opponent's grenade flight is not drawn; they see the explosion.
- Hit/removal counters are per machine; doors and windows are frames (indestructible) around barricade groups.
- The shipped house map is ground floor only for now; the second storey and stairs arrive with the vault/stairs stage.
- Three.js is pinned to 0.160.0 via jsDelivr.

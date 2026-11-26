// Shared game code (ES module). Stage 1: map grid, pointer lock, movement, stances, sprint, collision.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { MAPS } from "./maps/index.js";

// Cell types: 1 floor, 2 normal, 3 reinforced, 4 indestructible, 5 barricade, 6 crate/sill
const COLORS = { 1: 0x2b2f36, 2: 0x9a8f80, 3: 0x6b7a8f, 4: 0x55555d, 5: 0xa0703c, 6: 0xc49a4e, 7: 0x5b4a3a, 8: 0x4a3322 };
const CS = 0.25;      // metres per cell: walls are one cell (0.25 m) thick and built from many small cells
const STRIDE = 13;    // grid layers per floor: 1 slab + 12 wall cells (3 m)
const L12 = (...parts) => [1, ...parts.flatMap(([t, n]) => Array(n).fill(t))];   // slab + 12 cells, as [type, count] runs
// One shared legend: char -> cell types from the floor slab upward. Maps may override entries with map.legend.
// Types: 1 floor, 2 normal wall, 3 reinforced (2 hits), 4 indestructible, 5 barricade, 6 crate/sill (vaultable), 7 frame (indestructible), 8 barricade accent
export const LEGEND = {
  "#": L12([2, 12]), R: L12([3, 12]), X: L12([4, 12]), F: L12([7, 12]), ".": [1], " ": [],
  D: L12([8, 1], [5, 7], [8, 1], [7, 3]),                  // door panel column (2.25 m high) with rails, under a frame header
  E: L12([8, 9], [7, 3]),                                  // door edge column
  H: L12([8, 1], [5, 2], [8, 2], [5, 3], [8, 1], [7, 3]),  // door column with the handle
  W: L12([6, 4], [5, 5], [7, 3]),                          // window: 1 m vaultable sill, 1.25 m barricade, frame header
  M: L12([6, 4], [8, 5], [7, 3]),                          // window mullion
  b: [1, 6, 6, 6, 6],                                      // crate, 1 m high
  S: [1], 1: [1], 2: [1], "^": [1], v: [1], "<": [1], ">": [1],
};
const STAIRS = { "^": [0, 1], v: [0, -1], "<": [1, 0], ">": [-1, 0] };   // offset towards the downhill end

// Logs warnings, never throws.
export function validate(m) {
  const known = new Set([...Object.keys(LEGEND), ...Object.keys(m.legend || {})]);
  const n = { 1: 0, S: 0 };
  m.floors.forEach((rows, f) => rows.forEach((row, z) => {
    if (row.length !== rows[0].length) console.warn(`[map ${m.id}] floor ${f} row ${z}: length ${row.length}, expected ${rows[0].length}`);
    for (const ch of row) {
      if (!known.has(ch)) console.warn(`[map ${m.id}] floor ${f} row ${z}: unknown legend char "${ch}"`);
      if (ch in n) n[ch]++;
    }
  }));
  if (m.floors.length < 2) console.warn(`[map ${m.id}] needs a second floor`);
  if (!n[1]) console.warn(`[map ${m.id}] missing attacker spawn 1 (outside)`);
  if (!n.S) console.warn(`[map ${m.id}] missing bomb room marker S`);
}
MAPS.forEach(validate);

// Build the cell grid (Uint8Array of cell types, 0 = empty) and its single InstancedMesh.
function buildGrid(map, scene) {
  const W = Math.max(...map.floors.flatMap(f => f.map(r => r.length)));
  const D = Math.max(...map.floors.map(f => f.length));
  const L = STRIDE * map.floors.length + 1;
  const t = new Uint8Array(W * D * L);
  let cells = [];
  const spawn = [], sites = [], at = (x, y, z) => [(x + 0.5) * CS, y * CS, (z + 0.5) * CS];
  map.floors.forEach((rows, f) => rows.forEach((row, z) => [...row].forEach((ch, x) => {
    let col = (map.legend && map.legend[ch]) || LEGEND[ch] || [];
    const dn = STAIRS[ch];                           // stairs: height = run length from the downhill end
    if (dn) { let k = 1; while ((rows[z + dn[1] * k] || "")[x + dn[0] * k] === ch) k++; col = [1, ...Array(k).fill(4)]; }
    col.forEach((type, dy) => {
      const y = f * STRIDE + dy;
      t[x + z * W + y * W * D] = type;
      if (type !== 1) cells.push([x, y, z, type]);     // floor slabs are drawn separately
    });
    if (ch === "1") spawn.push(at(x, f * STRIDE + 1, z));
    if (ch === "S") sites.push(at(x, f * STRIDE + 1, z));
  })));

  // Skip wall cells that can never be seen (buried in indestructible mass), then draw floors as a few merged boxes.
  const ind = v => v === 1 || v === 4 || v === 6 || v === 7;
  const solidI = (x, y, z) => (y >= L ? false : x < 0 || z < 0 || y < 0 || x >= W || z >= D ? true : ind(t[x + z * W + y * W * D]));
  cells = cells.filter(([x, y, z, type]) => !(ind(type) && solidI(x - 1, y, z) && solidI(x + 1, y, z) && solidI(x, y - 1, z) && solidI(x, y + 1, z) && solidI(x, y, z - 1) && solidI(x, y, z + 1)));
  const runs = [];
  for (let f = 0; f < map.floors.length; f++) for (let z = 0; z < D; z++) for (let x = 0, s0 = -1; x <= W; x++) {
    const on = x < W && t[x + z * W + f * STRIDE * W * D] === 1;
    if (on && s0 < 0) s0 = x;
    if (s0 >= 0 && (!on || x - s0 >= 16)) { runs.push([s0, x, f, z]); s0 = on ? x : -1; }
  }
  const fm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), runs.length), fc = new THREE.Color(), f4 = new THREE.Matrix4();
  runs.forEach(([a, b, f, z], i) => {
    fm.setMatrixAt(i, f4.makeScale((b - a) * CS, CS, CS).setPosition((a + b) / 2 * CS, (f * STRIDE + 0.5) * CS, (z + 0.5) * CS));
    fm.setColorAt(i, fc.setHex(COLORS[1]).multiplyScalar(0.9 + Math.random() * 0.2));
  });
  fm.frustumCulled = false; scene.add(fm);

  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(CS, CS, CS), new THREE.MeshBasicMaterial(), cells.length);
  const m4 = new THREE.Matrix4(), c = new THREE.Color();
  cells.forEach(([x, y, z, type], i) => {
    mesh.setMatrixAt(i, m4.setPosition((x + 0.5) * CS, (y + 0.5) * CS, (z + 0.5) * CS));
    mesh.setColorAt(i, c.setHex(COLORS[type]).multiplyScalar(0.88 + Math.random() * 0.24)); // small random variation
  });
  mesh.frustumCulled = false;
  scene.add(mesh);

  // Destruction: cell-by-cell, plus barricade groups (connected type-5 cells share a group)
  const t0 = t.slice(), inst = new Int32Array(t.length).fill(-1), hp = new Uint8Array(t.length), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  cells.forEach(([x, y, z], i) => { inst[x + z * W + y * W * D] = i; });
  const grp = new Int16Array(t.length).fill(-1), groups = [];
  t.forEach((v, i) => {
    if ((v !== 5 && v !== 8) || grp[i] >= 0) return;
    const g = { cells: [], broke: 0, knife: 0 }, q = [i]; grp[i] = groups.length;
    while (q.length) {
      const c = q.pop(); g.cells.push(c);
      for (const n of [c - 1, c + 1, c - W, c + W, c - W * D, c + W * D]) if ((t[n] === 5 || t[n] === 8) && grp[n] < 0) { grp[n] = groups.length; q.push(n); }
    }
    groups.push(g);
  });
  const rm1 = (c, out) => { t[c] = 0; mesh.setMatrixAt(inst[c], ZERO); if (out) out.push(c); };
  // One hit on one cell. Returns the removed cell indices. A barricade goes entirely after 2 knife hits or when >1/3 of it is broken.
  function dmg(i, knife) {
    const type = t[i], out = [];
    if (type !== 2 && type !== 3 && type !== 5 && type !== 8) return out;
    if (type === 3 && --hp[i] > 0) return out;
    rm1(i, out);
    const g = grp[i] >= 0 && groups[grp[i]];
    if (g) { g.broke++; if (knife) g.knife++; if (g.knife >= 2 || g.broke * 3 > g.cells.length) g.cells.forEach(c => { if (t[c]) rm1(c, out); }); }
    mesh.instanceMatrix.needsUpdate = true;
    return out;
  }
  function drop(list) {                              // apply removals received from the other player
    list.forEach(c => { if (t[c]) { if (grp[c] >= 0) groups[grp[c]].broke++; rm1(c); } });
    mesh.instanceMatrix.needsUpdate = true;
  }
  function reset() {                                 // restore the original map
    t.set(t0); hp.fill(0); t.forEach((v, i) => { if (v === 3) hp[i] = 2; });
    groups.forEach(g => { g.broke = 0; g.knife = 0; });
    cells.forEach(([x, y, z], i) => mesh.setMatrixAt(i, m4.setPosition((x + 0.5) * CS, (y + 0.5) * CS, (z + 0.5) * CS)));
    mesh.instanceMatrix.needsUpdate = true;
  }
  reset();

  const ci = (x, y, z) => (x < 0 || z < 0 || y < 0 || x >= W || z >= D || y >= L ? -1 : x + z * W + y * W * D);
  const solidC = (x, y, z) => (x < 0 || z < 0 || y < 0 || x >= W || z >= D ? true : y >= L ? false : t[x + z * W + y * W * D] !== 0);
  const solid = (x, y, z) => solidC(Math.floor(x / CS), Math.floor(y / CS), Math.floor(z / CS));   // metres
  return { W, D, L, t, spawn, sites, mesh, ci, solidC, solid, dmg, drop, reset };
}

const R = 0.3;                      // player half-width
const H = [1.8, 1.2, 0.6];         // hitbox height: stand, crouch, prone
const EYE = [1.65, 1.1, 0.5];      // eye height per stance
const SPD = [4.5, 2.5, 1.2];       // walk speed per stance (m/s)
const SPRINT = 7, GRAVITY = 18, JUMP = 5.5, SENS = 0.002, ROUND_TIME = 120, WIN_ROUNDS = 5;
// One data table; add a row to add a weapon. wall = cells removed per hit.
export const WEAPONS = [
  { n: "Pistol",   dmg: 25, rate: 5,   auto: false, mag: 12, reload: 1.2, spread: 0.012, recoil: 0.012, range: 60,  hs: 2,   wall: 1, zoom: 1.2 },
  { n: "SMG",      dmg: 17, rate: 14,  auto: true,  mag: 30, reload: 1.6, spread: 0.022, recoil: 0.007, range: 50,  hs: 1.8, wall: 1, zoom: 1.2 },
  { n: "Rifle",    dmg: 28, rate: 9,   auto: true,  mag: 30, reload: 2.0, spread: 0.016, recoil: 0.012, range: 100, hs: 2,   wall: 2, zoom: 1.5 },
  { n: "Shotgun",  dmg: 12, rate: 1.2, auto: false, mag: 6,  reload: 2.4, spread: 0.06,  recoil: 0.04,  range: 25,  hs: 1.5, wall: 3, zoom: 1.2, pellets: 8 },
  { n: "Marksman", dmg: 70, rate: 1.6, auto: false, mag: 8,  reload: 2.2, spread: 0.003, recoil: 0.05,  range: 150, hs: 2,   wall: 4, zoom: 2.5 },
];

export function startGame({ role = "guest", conn = null, mapId = null } = {}) {
  const id = mapId || new URLSearchParams(location.search).get("map");   // ?map=id for quick testing
  const map = MAPS.find(m => m.id === id) || MAPS[0];

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87a8c8);
  const G = buildGrid(map, scene);
  const cam = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 200);
  cam.rotation.order = "YXZ";
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);
  addEventListener("resize", () => {
    renderer.setSize(innerWidth, innerHeight);
    cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
  });

  const [sx, sy, sz] = G.spawn[0] || [1.5, 0.5, 1.5];
  const p = { x: sx, y: sy, z: sz, vy: 0, yaw: 0, pitch: 0, stance: 0, eye: EYE[0], sprint: false, onGround: false, vault: null, vis: 0 };

  // True if a player-sized box at p (with height h) overlaps any solid cell.
  const hit = (h) => {
    const x1 = Math.floor((p.x + R - 1e-4) / CS), z1 = Math.floor((p.z + R - 1e-4) / CS), y1 = Math.floor((p.y + h - 1e-4) / CS);
    for (let x = Math.floor((p.x - R) / CS); x <= x1; x++)
      for (let z = Math.floor((p.z - R) / CS); z <= z1; z++)
        for (let y = Math.floor(p.y / CS); y <= y1; y++)
          if (G.solidC(x, y, z)) return true;
    return false;
  };
  const setStance = (s) => { if (s === p.stance || hit(H[s])) return false; p.stance = s; return true; };

  // Input
  const keys = {};
  const canvas = renderer.domElement, msg = document.getElementById("msg"), hud = document.getElementById("hud");
  canvas.onclick = () => canvas.requestPointerLock();
  document.addEventListener("pointerlockchange", () => { if (msg) msg.style.display = document.pointerLockElement ? "none" : "flex"; });
  document.addEventListener("mousemove", e => {
    if (!document.pointerLockElement) return;
    p.yaw -= e.movementX * SENS;
    p.pitch = Math.max(-1.55, Math.min(1.55, p.pitch - e.movementY * SENS));
  });
  addEventListener("keydown", e => {
    keys[e.code] = true;
    if (e.code === "Space") e.preventDefault();
    if (e.repeat) return;
    if (e.code === "Space") tryVault();
    if (e.code === "KeyC") setStance(p.stance === 1 ? 0 : 1);
    if (e.code === "KeyX") setStance(p.stance === 2 ? 0 : 2);
  });
  addEventListener("keyup", e => { keys[e.code] = false; });
  addEventListener("blur", () => { for (const k in keys) keys[k] = false; });

  // Vault: Space at a 1 m high crate/sill (type-6 cells) with free space above and a free landing spot.
  const VAULT_TIME = 0.45;
  function tryVault() {
    if (p.vault || !p.onGround || p.stance === 2 || !S.live) return;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const cx = Math.floor((p.x + fx * 0.7) / CS), cz = Math.floor((p.z + fz * 0.7) / CS), cy = Math.floor(p.y / CS);
    const ty = k => G.t[G.ci(cx, cy + k, cz)], CH = Math.round(1 / CS);     // a vaultable object is exactly 1 m high
    for (let k = 0; k < CH; k++) if (ty(k) !== 6) return;
    if (G.solidC(cx, cy + CH, cz) || G.solidC(cx, cy + CH + 1, cz)) return;
    const x0 = p.x, z0 = p.z, x1 = x0 + fx * 1.7, z1 = z0 + fz * 1.7;
    p.x = x1; p.z = z1;
    const blocked = hit(H[0]);                 // landing must fit a standing body
    p.x = x0; p.z = z0;
    if (blocked) return;                       // fall back to a normal jump
    p.stance = 0;
    p.vault = { t: 0, x0, z0, x1, z1, y: p.y };
  }
  function vaultStep(dt) {                     // scripted move, no collision; the player can still look around
    const v = p.vault, k = Math.min(1, (v.t += dt) / VAULT_TIME);
    p.x = v.x0 + (v.x1 - v.x0) * k;
    p.z = v.z0 + (v.z1 - v.z0) * k;
    p.y = v.y + Math.sin(Math.PI * k) * 1.1;
    p.vy = 0; p.sprint = false; p.onGround = false; S.rel = 0; S.ads = false;
    if (k >= 1) p.vault = null;
  }

  // Move along one axis; if blocked while grounded, try stepping up one cell (this is how stairs work).
  function slide(dx, dz) {
    p.x += dx; p.z += dz;
    if (!hit(H[p.stance])) return;
    if (p.onGround) { p.y += CS; if (!hit(H[p.stance])) { p.vis -= CS; return; } p.y -= CS; }
    p.x -= dx; p.z -= dz;
  }

  function walk(dt) {
    const lv = S.live ? 1 : 0, mx = lv * ((keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0)), mz = lv * ((keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0));
    const moving = mx || mz; S.mv = moving ? 1 : 0;

    // Sprinting stands the player up first; if there is no room, no sprint.
    const wantSprint = (keys.ShiftLeft || keys.ShiftRight) && moving;
    if (wantSprint && p.stance) setStance(0);
    p.sprint = !!wantSprint && p.stance === 0;
    if (p.sprint) S.rel = 0;                     // sprinting cancels a reload (ADS is blocked while sprinting)

    const s = Math.sin(p.yaw), c = Math.cos(p.yaw), l = Math.hypot(mx, mz) || 1;
    const step = (p.sprint ? SPRINT : SPD[p.stance]) * (S.ads ? 0.6 : 1) * dt;
    const dx = (mx * c + mz * s) / l * step + S.kx * dt, dz = (-mx * s + mz * c) / l * step + S.kz * dt;
    S.kx *= 1 - dt * 4; S.kz *= 1 - dt * 4;      // grenade knockback decays
    slide(dx, 0); slide(0, dz);                  // axes resolved separately so walls slide

    if (S.live && keys.Space && p.onGround && p.stance === 0) p.vy = JUMP;
    p.vy -= GRAVITY * dt;
    p.y += p.vy * dt;
    if (hit(H[p.stance])) { p.y -= p.vy * dt; p.onGround = p.vy < 0; p.vy = 0; } else p.onGround = false;
    if (p.y < -10) { p.x = sx; p.y = sy; p.z = sz; p.vy = 0; }

  }

  // ===== Stages 3-6: weapons, destruction, grenades, network, rounds =====
  const isHost = role === "admin", myId = isHost ? 1 : 2, TAU = Math.PI * 2;
  const r1 = v => Math.round(v * 10) / 10, r10 = v => Math.round(v * 10);
  const S = { w: 0, rel: 0, next: 0, ads: false, lean: 0, hp: 100, gren: 4, live: false, kx: 0, kz: 0, heat: 0, mv: 0, knifeAt: 0, swing: 0,
    g: null, aim: false, round: 0, att: 1, score: [0, 0], rLeft: 0, bLeft: 0, bomb: null, prog: 0, ending: false, over: false, snd: 0, fs: 0, ph: 0 };
  const ammo = WEAPONS.map(w => ({ mag: w.mag, res: isHost ? Infinity : 2 * w.mag }));
  const mouse = [false, false, false];
  const send = m => { if (conn && conn.open) conn.send(m); };
  let T = 0, rp = null, rt = null, flashN = 0, boomN = 0, tr = 0, wi = 0;
  const xh = document.getElementById("xh");
  hud.style.whiteSpace = "pre";
  const note = document.createElement("div");
  note.style.cssText = "position:fixed;top:12%;width:100%;text-align:center;z-index:1;font:20px monospace;color:#fff;text-shadow:0 0 4px #000;pointer-events:none";
  document.body.appendChild(note);

  // Boxes only: viewmodel, flash, tracers, bomb, grenade, remote player
  const mk = (sx, sy, sz, col, par = scene, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial({ color: col }));
    m.position.set(x, y, z); par.add(m); return m;
  };
  const hide = m => { m.visible = false; return m; };
  scene.add(cam);
  const gun = new THREE.Group(); cam.add(gun);
  mk(0.07, 0.09, 0.4, 0x333840, gun, 0.2, -0.2, -0.5); mk(0.035, 0.035, 0.25, 0x1c1f24, gun, 0.2, -0.17, -0.8); mk(0.02, 0.03, 0.03, 0x999999, gun, 0.2, -0.14, -0.45);
  mk(0.08, 0.08, 0.35, 0x3a3f48, gun, 0.27, -0.28, -0.25); mk(0.07, 0.07, 0.1, 0xf0c8a0, gun, 0.21, -0.25, -0.42);   // right arm, hand on the grip
  mk(0.08, 0.08, 0.35, 0x3a3f48, gun, 0.05, -0.28, -0.4); mk(0.07, 0.07, 0.1, 0xf0c8a0, gun, 0.16, -0.2, -0.68);     // left arm, hand on the barrel
  const knifeM = hide(mk(0.03, 0.03, 0.4, 0xbbbbbb, cam, 0.1, -0.15, -0.5));
  const flash = hide(mk(0.12, 0.12, 0.12, 0xffee55)), boomM = hide(mk(3, 3, 3, 0xff7a22)), bombM = hide(mk(0.4, 0.25, 0.4, 0xdd2222));
  const gm = hide(mk(0.15, 0.15, 0.15, 0x2a5a2a)), marker = hide(mk(0.25, 0.25, 0.25, 0xff3030)), siteM = mk(0.12, 1.2, 0.12, 0xff3030);
  // Remote player: a box rig (legs swing, head pitches, helmet, vest, arms holding a gun)
  const rig = new THREE.Group(); rig.rotation.order = "YXZ"; rig.visible = false; scene.add(rig);
  const part = (w, h, d, col, x, y, z, dy = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); rig.add(g); mk(w, h, d, col, g, 0, dy, 0); return g; };
  const legL = part(0.17, 0.8, 0.2, 0x2f3a4a, -0.12, 0.85, 0, -0.4), legR = part(0.17, 0.8, 0.2, 0x2f3a4a, 0.12, 0.85, 0, -0.4);
  part(0.5, 0.6, 0.28, 0xb03a3a, 0, 1.15, 0); part(0.52, 0.12, 0.3, 0x3a3f48, 0, 0.88, 0);            // vest, belt
  const head = part(0.26, 0.26, 0.26, 0xf0c8a0, 0, 1.6, 0);
  mk(0.3, 0.12, 0.3, 0x2a2e36, head, 0, 0.14, 0); mk(0.2, 0.06, 0.04, 0x1a1a1a, head, 0, 0.02, -0.14);  // helmet, visor
  part(0.12, 0.12, 0.45, 0x3a3f48, 0.2, 1.3, -0.25); part(0.12, 0.12, 0.35, 0x3a3f48, -0.15, 1.3, -0.25); part(0.07, 0.1, 0.55, 0x222222, 0.1, 1.32, -0.45);  // arms, gun
  const tracers = Array.from({ length: 8 }, () => hide(mk(1, 1, 1, 0xffe28a))), tl = new Float32Array(8);
  const pv = new Float32Array(90), pg = {}, pvGeo = new THREE.BufferGeometry();     // grenade preview: one pre-allocated line
  pvGeo.setAttribute("position", new THREE.BufferAttribute(pv, 3));
  const pvLine = hide(new THREE.Line(pvGeo, new THREE.LineBasicMaterial({ color: 0xffffff }))); pvLine.frustumCulled = false; scene.add(pvLine);
  const wedges = Array.from({ length: 4 }, () => {                                   // footstep indicator: 2D DOM pool
    const e = document.createElement("div"); e.textContent = "\u25B2";
    e.style.cssText = "position:fixed;left:50%;top:50%;z-index:1;color:#ff5a3c;opacity:0;pointer-events:none;font-size:22px";
    document.body.appendChild(e); return e;
  });

  const fwd = (yaw, pitch) => [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  const hh = r => H[r.vault ? 1 : r.st];
  const near = (x, z, r) => Math.hypot(p.x - x, p.z - z) < r;
  const remoteBox = () => [[rp.x - R, rp.y, rp.z - R], [rp.x + R, rp.y + hh(rp), rp.z + R]];

  // DDA grid raycast (metres in and out): [distance, cell index or -1] of the first solid cell, or null
  function cast(o, d, max) {
    const g = o.map(v => v / CS), c = g.map(Math.floor), st = d.map(a => (a > 0 ? 1 : -1)), td = d.map(a => (a ? Math.abs(1 / a) : 1e9));
    const tm = d.map((a, i) => (a ? (a > 0 ? c[i] + 1 - g[i] : g[i] - c[i]) * td[i] : 1e9));
    for (let t = 0; t * CS <= max;) {
      if (G.solidC(c[0], c[1], c[2])) return [t * CS, G.ci(c[0], c[1], c[2])];
      const i = tm[0] < tm[1] ? (tm[0] < tm[2] ? 0 : 2) : (tm[1] < tm[2] ? 1 : 2);
      t = tm[i]; tm[i] += td[i]; c[i] += st[i];
    }
    return null;
  }
  function rayBox(o, d, lo, hi) {
    let t0 = 0, t1 = 1e9;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo[i] || o[i] > hi[i]) return -1; continue; }
      const a = (lo[i] - o[i]) / d[i], b = (hi[i] - o[i]) / d[i];
      t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
    }
    return t0 <= t1 ? t0 : -1;
  }
  // Remove up to n cells along the ray (stops if a cell survives, e.g. reinforced)
  function bore(o, d, range, n) {
    const out = [];
    for (let k = 0; k < n; k++) {
      const r = cast(o, d, range); if (!r || r[1] < 0) break;
      const rm = G.dmg(r[1]); if (!rm.length) break;
      out.push(...rm); o = [o[0] + d[0] * (r[0] + 0.02), o[1] + d[1] * (r[0] + 0.02), o[2] + d[2] * (r[0] + 0.02)];
    }
    return out;
  }
  function shot(o, d, w) {
    const r = cast(o, d, w.range), tw = r ? r[0] : w.range;
    const te = rp ? rayBox(o, d, ...remoteBox()) : -1, hitE = te >= 0 && te < tw && te <= w.range, t = hitE ? te : tw;
    const e = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    if (hitE) return { e, dmg: Math.round(w.dmg * (e[1] > rp.y + hh(rp) - 0.3 ? w.hs : 1)) };
    return { e, cells: r && r[1] >= 0 ? bore(o, d, w.range, w.wall) : [] };
  }

  // Effects
  function tracer(a, b) {
    const m = tracers[tr], len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); m.lookAt(b[0], b[1], b[2]);
    m.scale.set(0.03, 0.03, len); m.visible = true; tl[tr] = 0.12; tr = (tr + 1) % 8;
  }
  const flashAt = b => { flash.position.set(b[0], b[1], b[2]); flash.visible = true; flashN = 2; };
  const showBoom = b => { boomM.position.set(b[0], b[1], b[2]); boomM.visible = true; boomN = 4; };
  function pulse() {
    const dx = rp.x - p.x, dz = rp.z - p.z, d = Math.hypot(dx, dz); if (d > 15) return;
    const rel = Math.atan2(-dx, -dz) - p.yaw, e = wedges[wi++ % 4], k = 1 - d / 15;
    e.style.transition = "none"; e.style.opacity = 0.4 + 0.6 * k;
    e.style.transform = `translate(-50%,-50%) translate(${-Math.sin(rel) * 120}px,${-Math.cos(rel) * 120}px) rotate(${-rel}rad) scale(${0.6 + k})`;
    e.offsetWidth;                                   // force reflow so the fade restarts
    e.style.transition = "opacity 1s"; e.style.opacity = 0;
  }

  // Weapons
  const spread = w => w.spread * (S.ads ? 0.35 : 1) * (1 + (p.sprint ? 2.5 : S.mv ? 0.8 : 0) + S.heat);
  function reload() {
    const a = ammo[S.w];
    if (S.live && !S.rel && a.mag < WEAPONS[S.w].mag && a.res > 0) S.rel = T + WEAPONS[S.w].reload;
  }
  function fire() {
    const w = WEAPONS[S.w], a = ammo[S.w];
    if (!S.live || p.vault || S.aim || S.rel || T < S.next) return;
    if (a.mag <= 0) { reload(); return; }
    S.next = T + 1 / w.rate; a.mag--; S.heat = Math.min(1.5, S.heat + 0.2);
    const o = cam.position.toArray(), sp = spread(w), mz = cam.localToWorld(new THREE.Vector3(0.2 + gun.position.x, -0.17 + gun.position.y, -0.85)).toArray();
    let dmg = 0, cells = [], end = o;
    for (let k = 0; k < (w.pellets || 1); k++) {
      const r = shot(o, fwd(p.yaw + (Math.random() - 0.5) * 2 * sp, p.pitch + (Math.random() - 0.5) * 2 * sp), w);
      dmg += r.dmg || 0; if (r.cells) cells.push(...r.cells); end = r.e;
    }
    tracer(mz, end); flashAt(mz);
    send({ t: "shot", o: mz.map(r1), e: end.map(r1) });
    if (dmg) send({ t: "dmg", n: dmg });
    if (cells.length) send({ t: "cells", i: cells });
    p.pitch += w.recoil; p.yaw += (Math.random() - 0.5) * w.recoil;
  }
  function knife() {
    if (!S.live || p.vault || T < S.knifeAt) return;
    S.knifeAt = T + 0.6; S.swing = 0.2; S.rel = 0;
    const o = cam.position.toArray(), d = fwd(p.yaw, p.pitch), r = cast(o, d, 2);
    const te = rp ? rayBox(o, d, ...remoteBox()) : -1;
    if (te >= 0 && te <= 2 && (!r || te < r[0])) send({ t: "dmg", n: 50 });
    else if (r && r[1] >= 0) { const rm = G.dmg(r[1], true); if (rm.length) send({ t: "cells", i: rm }); }
  }

  // Impact grenades: the preview and the real throw share gstep()
  const GSTEP = 0.04, GRAV = 14;
  function gstep(g) {
    g.vy -= GRAV * GSTEP;
    const nx = g.x + g.vx * GSTEP, ny = g.y + g.vy * GSTEP, nz = g.z + g.vz * GSTEP;
    if (G.solid(nx, ny, nz) || (rp && Math.hypot(nx - rp.x, nz - rp.z) < 0.5 && ny > rp.y && ny < rp.y + hh(rp))) return true;
    g.x = nx; g.y = ny; g.z = nz; return false;
  }
  function initG(g) {
    const cp = Math.cos(p.pitch), dx = -Math.sin(p.yaw) * cp, dy = Math.sin(p.pitch), dz = -Math.cos(p.yaw) * cp, c = cam.position;
    g.x = c.x + dx * 0.5; g.y = c.y + dy * 0.5; g.z = c.z + dz * 0.5; g.vx = dx * 13; g.vy = dy * 13 + 2.5; g.vz = dz * 13; g.acc = 0;
    return g;
  }
  function preview() {
    initG(pg); let done = false;
    for (let i = 0; i < 30; i++) {
      if (!done) done = gstep(pg);
      pv[i * 3] = pg.x; pv[i * 3 + 1] = pg.y; pv[i * 3 + 2] = pg.z;
    }
    pvGeo.attributes.position.needsUpdate = true; marker.position.set(pg.x, pg.y, pg.z);
  }
  function throwG() { if (S.live && !p.vault && !S.g && S.gren > 0) { S.gren--; S.g = initG({}); } }
  function boom(g) {
    const rm = [], rad = 1.8, f = v => Math.floor(v / CS);
    for (let x = f(g.x - rad); x <= f(g.x + rad); x++)
      for (let y = f(g.y - rad); y <= f(g.y + rad); y++)
        for (let z = f(g.z - rad); z <= f(g.z + rad); z++)
          if (G.ci(x, y, z) >= 0 && Math.hypot((x + 0.5) * CS - g.x, (y + 0.5) * CS - g.y, (z + 0.5) * CS - g.z) < rad)
            rm.push(...G.dmg(G.ci(x, y, z)));
    if (rm.length) send({ t: "cells", i: rm });
    const b = [g.x, g.y, g.z]; showBoom(b); send({ t: "boom", p: b });
    const hurt = (x, y, z) => {
      const d = Math.hypot(x - g.x, y + 0.9 - g.y, z - g.z), f = 1 - d / 5;
      return d < 5 ? [Math.round(120 * f), (x - g.x) / (d || 1) * 8 * f, (z - g.z) / (d || 1) * 8 * f] : null;
    };
    const me = hurt(p.x, p.y, p.z); if (me) applyDamage(...me);
    const en = rp && hurt(rp.x, rp.y, rp.z); if (en) send({ t: "dmg", n: en[0], k: [en[1], en[2]] });
  }

  // Rounds, bomb, score (the host owns the state)
  function applyDamage(n, kx = 0, kz = 0) {
    if (!S.live) return;
    S.hp -= n; S.kx += kx; S.kz += kz;
    if (S.hp <= 0) { S.hp = 0; S.live = false; if (isHost) endRound(2); else send({ t: "died" }); }
  }
  // Each round: the attacker starts outside; the defender starts in a random bomb room (index si, chosen by the host).
  const pick = a => a[Math.floor(Math.random() * a.length)];
  function beginRound(n, att, si) {
    G.reset();                                       // map restored locally, no cell data is sent
    const site = G.sites[si] || G.spawn[0] || [1.5, 0.5, 1.5];
    Object.assign(S, { round: n, att, site, hp: 100, gren: 4, g: null, bomb: null, bLeft: 0, rLeft: ROUND_TIME, prog: 0, rel: 0, kx: 0, kz: 0, live: true, aim: false });
    const [x, y, z] = myId === att ? pick(G.spawn) || site : site;
    Object.assign(p, { x, y, z, vy: 0, vault: null, stance: 0, eye: EYE[0], vis: 0 });
    siteM.position.set(site[0], site[1] + 0.6, site[2]);
    rp = rt = null; rig.visible = bombM.visible = false; note.textContent = "";
  }
  function startRound() {
    const n = S.round + 1, att = n % 2 ? 1 : 2, si = Math.floor(Math.random() * G.sites.length);
    send({ t: "round", n, att, si }); beginRound(n, att, si);
  }
  const showEnd = (win, score) => { S.live = false; S.score = score; note.textContent = win === myId ? "Round won" : "Round lost"; };
  const showOver = win => { S.live = false; S.over = true; note.textContent = win === myId ? "You win the match" : "You lose the match"; };
  function endRound(win) {
    if (S.ending || S.over) return; S.ending = true;
    S.score[win - 1]++; send({ t: "end", win, score: S.score }); showEnd(win, S.score);
    setTimeout(() => {
      S.ending = false;
      if (S.score[win - 1] >= WIN_ROUNDS) { send({ t: "over", win }); showOver(win); } else startRound();
    }, 3000);
  }
  function plant(b) { S.bomb = b; S.bLeft = 30; bombM.position.set(b.x, b.y + 0.15, b.z); bombM.visible = true; }
  function defused() { S.bomb = null; bombM.visible = false; if (isHost) endRound(3 - S.att); }

  // Network messages
  function onMsg(m) {
    switch (m.t) {
      case "s": {
        const a = m.a, n = { x: a[0] / 10, y: a[1] / 10, z: a[2] / 10, yaw: a[3] / 1000, pitch: a[4] / 1000, st: a[5] & 3, vault: !!(a[5] & 16) };
        if (!rp || Math.hypot(n.x - rp.x, n.z - rp.z) > 3) rp = { ...n };   // snap after a teleport
        rt = n; break;
      }
      case "shot": tracer(m.o, m.e); flashAt(m.o); break;
      case "dmg": applyDamage(m.n, ...(m.k || [0, 0])); break;
      case "cells": G.drop(m.i); break;
      case "boom": showBoom(m.p); break;
      case "round": beginRound(m.n, m.att, m.si); break;
      case "end": showEnd(m.win, m.score); break;
      case "over": showOver(m.win); break;
      case "plant": plant(m.b); break;
      case "defuse": defused(); break;
      case "died": if (isHost) endRound(1); break;
    }
  }

  // Input for weapons
  addEventListener("mousedown", e => {
    if (!document.pointerLockElement) return;
    mouse[e.button] = true;
    if (e.button === 0 && !WEAPONS[S.w].auto) fire();     // semi-auto: exactly one shot per click
  });
  addEventListener("mouseup", e => { mouse[e.button] = false; });
  addEventListener("contextmenu", e => e.preventDefault());
  addEventListener("keydown", e => {
    if (e.repeat || !S.live) return;
    if (e.code === "KeyR") reload();
    if (e.code === "KeyV") knife();
    if (e.code === "KeyG" && S.gren > 0 && !S.g && !p.vault) S.aim = true;
    if (e.code.startsWith("Digit")) { const n = +e.code.slice(5); if (n >= 1 && n <= WEAPONS.length) { S.w = n - 1; S.rel = 0; } }
  });
  addEventListener("keyup", e => { if (e.code === "KeyG" && S.aim) { S.aim = false; throwG(); } });

  function update(dt) {
    T += dt;
    if (p.vault) vaultStep(dt); else walk(dt);
    S.ads = !!mouse[2] && S.live && !p.sprint && !p.vault;
    const w = WEAPONS[S.w], a = ammo[S.w];

    // lean (hold Q/E), blocked by walls
    let lt = S.live && !p.vault ? (keys.KeyE ? 1 : 0) - (keys.KeyQ ? 1 : 0) : 0;
    const rx = Math.cos(p.yaw) * 0.4, rz = -Math.sin(p.yaw) * 0.4;
    if (lt) { p.x += rx * lt; p.z += rz * lt; const b = hit(H[p.stance]); p.x -= rx * lt; p.z -= rz * lt; if (b) lt = 0; }
    S.lean += (lt - S.lean) * Math.min(1, dt * 10);

    p.eye += (EYE[p.stance] - p.eye) * Math.min(1, dt * 12);
    p.vis *= Math.max(0, 1 - dt * 12);               // smooths the camera after a step-up
    cam.position.set(p.x + rx * S.lean, p.y + p.vis + p.eye, p.z + rz * S.lean);
    cam.rotation.set(p.pitch, p.yaw, -S.lean * 0.2);
    cam.updateMatrixWorld();
    const fov = 75 / (S.ads ? w.zoom : 1);
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 14); cam.updateProjectionMatrix(); }

    if (S.rel && T >= S.rel) { const n = Math.min(w.mag - a.mag, a.res); a.mag += n; if (isFinite(a.res)) a.res -= n; S.rel = 0; }
    if (mouse[0] && w.auto && document.pointerLockElement) fire();
    S.heat = Math.max(0, S.heat - dt * 1.5); S.swing = Math.max(0, S.swing - dt);

    const k = Math.min(1, dt * 14);                  // viewmodel: ADS centres the gun, vault dips it
    gun.position.x += ((S.ads ? -0.2 : 0) - gun.position.x) * k;
    gun.position.y += ((p.vault ? -0.15 : S.ads ? 0.04 : 0) - gun.position.y) * k;
    knifeM.visible = S.swing > 0; knifeM.position.z = -0.5 - Math.sin(S.swing / 0.2 * Math.PI) * 0.3;

    for (let i = 0; i < 8; i++) if (tl[i] > 0) {
      tl[i] -= dt; tracers[i].scale.x = tracers[i].scale.y = 0.03 * Math.max(0, tl[i] / 0.12);
      if (tl[i] <= 0) tracers[i].visible = false;
    }
    if (flashN && --flashN === 0) flash.visible = false;
    if (boomN && --boomN === 0) boomM.visible = false;

    pvLine.visible = marker.visible = S.aim && S.live && !p.vault;
    if (pvLine.visible) preview();
    if (S.g) {
      S.g.acc += dt;
      while (S.g && S.g.acc >= GSTEP) { S.g.acc -= GSTEP; if (gstep(S.g)) { boom(S.g); S.g = null; } }
    }
    gm.visible = !!S.g; if (S.g) gm.position.set(S.g.x, S.g.y, S.g.z);

    if (rt) {                                        // remote player: smooth toward the latest 10 Hz state
      const kk = Math.min(1, dt * 12), ox = rp.x, oz = rp.z;
      rp.x += (rt.x - rp.x) * kk; rp.y += (rt.y - rp.y) * kk; rp.z += (rt.z - rp.z) * kk;
      rp.yaw += Math.atan2(Math.sin(rt.yaw - rp.yaw), Math.cos(rt.yaw - rp.yaw)) * kk;
      rp.st = rt.st; rp.vault = rt.vault; rp.pitch = rt.pitch;
      const mv = Math.hypot(rp.x - ox, rp.z - oz), sp = Math.min(1, mv / dt / 2);
      S.ph += mv * 4; legL.rotation.x = Math.sin(S.ph) * 0.7 * sp; legR.rotation.x = -legL.rotation.x;
      rig.visible = true; rig.position.set(rp.x, rp.y + (rp.st === 2 ? 0.15 : 0), rp.z); rig.rotation.set(0, rp.yaw, 0); rig.scale.y = 1;
      if (rp.st === 2) { rig.rotation.x = -Math.PI / 2; rig.scale.y = 0.45; } else if (rp.st === 1 || rp.vault) rig.scale.y = H[1] / H[0];
      head.rotation.x = rp.pitch;
      if (rp.st === 0 && !rp.vault && S.live) { S.fs += Math.hypot(rp.x - ox, rp.z - oz); if (S.fs >= 2) { S.fs = 0; pulse(); } }
    }

    if (S.live) {
      if (S.bomb) { S.bLeft -= dt; if (isHost && S.bLeft <= 0) endRound(S.att); }
      else { S.rLeft -= dt; if (isHost && S.rLeft <= 0) endRound(3 - S.att); }
    }
    let need = 0;                                    // hold F: attacker plants 3 s, defender defuses 5 s
    if (S.live && keys.KeyF && !p.vault) {
      const at = (x, y, z, r) => near(x, z, r) && Math.abs(p.y - y) < 1.5;     // same floor
      if (myId === S.att && !S.bomb && at(S.site[0], S.site[1], S.site[2], 2.2)) need = 3;
      if (myId !== S.att && S.bomb && at(S.bomb.x, S.bomb.y, S.bomb.z, 2)) need = 5;
    }
    S.prog = need ? S.prog + dt : 0;
    if (need && S.prog >= need) {
      S.prog = 0;
      if (need === 3) { const b = { x: p.x, y: p.y, z: p.z }; plant(b); send({ t: "plant", b }); }
      else { send({ t: "defuse" }); defused(); }
    }

    if ((S.snd += dt) >= 0.1) {                      // 10 Hz state: small integer array
      S.snd = 0;
      send({ t: "s", a: [r10(p.x), r10(p.y), r10(p.z), Math.round(((p.yaw % TAU) + TAU) % TAU * 1000), Math.round(p.pitch * 1000), p.stance + (Math.round(S.lean) + 1) * 4 + (p.vault ? 16 : 0)] });
    }

    if (xh) xh.style.width = xh.style.height = 4 + spread(w) * 1300 + "px";
    const t2 = s => Math.max(0, Math.ceil(s)), q = S.site;
    const sd = q && myId === S.att && !S.bomb ? `  SITE ${Math.round(Math.hypot(q[0] - p.x, q[2] - p.z))}m ${Math.abs(q[0] - p.x) > Math.abs(q[2] - p.z) ? (q[0] > p.x ? "E" : "W") : (q[2] > p.z ? "S" : "N")} floor ${Math.floor(q[1] / (STRIDE * CS)) + 1}` : "";
    hud.textContent = `HP ${S.hp}   ${w.n} ${a.mag}/${isFinite(a.res) ? a.res : "\u221E"}${S.rel ? " (reloading)" : ""}   Grenades ${S.gren}   ${["stand", "crouch", "prone"][p.stance]}${p.sprint ? " sprint" : ""}\n` +
      `Round ${S.round} ${myId === S.att ? "ATTACK" : "DEFEND"}  Score ${S.score[myId - 1]}-${S.score[2 - myId]}  Time ${t2(S.rLeft)}${sd}${S.bomb ? "  BOMB " + t2(S.bLeft) : ""}${need ? "  hold F " + Math.round(S.prog / need * 100) + "%" : ""}`;
  }

  if (conn) {
    conn.on("data", onMsg);
    conn.on("close", () => { S.live = false; S.over = true; note.textContent = "Connection lost. Match ended."; });
  }
  if (msg) msg.style.display = "flex";
  if (isHost) startRound();

  let last = performance.now();
  (function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    update(dt);
    renderer.render(scene, cam);
  })(last);
}

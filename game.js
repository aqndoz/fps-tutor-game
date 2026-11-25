// Shared game code (ES module). Stage 1: map grid, pointer lock, movement, stances, sprint, collision.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { MAPS } from "./maps/index.js";

// Cell types: 1 floor, 2 normal, 3 reinforced, 4 indestructible, 5 barricade, 6 crate/sill
const COLORS = { 1: 0x2b2f36, 2: 0x9a8f80, 3: 0x6b7a8f, 4: 0x55555d, 5: 0xa0703c, 6: 0xc49a4e };
// One shared legend: char -> cell types from the floor slab (dy 0) upward. Maps may override with map.legend.
export const LEGEND = {
  "#": [1, 2, 2, 2], R: [1, 3, 3, 3], X: [1, 4, 4, 4], ".": [1], " ": [],
  D: [1, 5, 5, 5], W: [1, 6, 5, 2], b: [1, 6], S: [1], 1: [1], 2: [1], "^": [1],
};
const STRIDE = 4; // grid layers per floor: slab + 3 m of wall

// Logs warnings, never throws.
export function validate(m) {
  const known = new Set([...Object.keys(LEGEND), ...Object.keys(m.legend || {})]);
  const n = { 1: 0, 2: 0, S: 0 };
  m.floors.forEach((rows, f) => rows.forEach((row, z) => {
    if (row.length !== rows[0].length) console.warn(`[map ${m.id}] floor ${f} row ${z}: length ${row.length}, expected ${rows[0].length}`);
    for (const ch of row) {
      if (!known.has(ch)) console.warn(`[map ${m.id}] floor ${f} row ${z}: unknown legend char "${ch}"`);
      if (ch in n) n[ch]++;
    }
  }));
  if (!n[1]) console.warn(`[map ${m.id}] missing spawn 1`);
  if (!n[2]) console.warn(`[map ${m.id}] missing spawn 2`);
  if (!n.S) console.warn(`[map ${m.id}] missing bomb site S`);
}
MAPS.forEach(validate);

// Build the cell grid (Uint8Array of cell types, 0 = empty) and its single InstancedMesh.
function buildGrid(map, scene) {
  const W = Math.max(...map.floors.flatMap(f => f.map(r => r.length)));
  const D = Math.max(...map.floors.map(f => f.length));
  const L = STRIDE * map.floors.length + 1;
  const t = new Uint8Array(W * D * L);
  const spawn = {}, site = [], cells = [];
  map.floors.forEach((rows, f) => rows.forEach((row, z) => [...row].forEach((ch, x) => {
    const col = (map.legend && map.legend[ch]) || LEGEND[ch] || [];
    col.forEach((type, dy) => {
      const y = f * STRIDE + dy;
      t[x + z * W + y * W * D] = type;
      cells.push([x, y, z, type]);
    });
    if (ch === "1" || ch === "2") spawn[ch] = [x + 0.5, f * STRIDE + 1, z + 0.5];
    if (ch === "S") site.push([x, f * STRIDE + 1, z]);
  })));

  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), cells.length);
  const m4 = new THREE.Matrix4(), c = new THREE.Color();
  cells.forEach(([x, y, z, type], i) => {
    mesh.setMatrixAt(i, m4.setPosition(x + 0.5, y + 0.5, z + 0.5));
    mesh.setColorAt(i, c.setHex(COLORS[type]).multiplyScalar(0.88 + Math.random() * 0.24)); // small random variation
  });
  scene.add(mesh);

  const solid = (x, y, z) => {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (x < 0 || z < 0 || x >= W || z >= D || y < 0) return true;
    if (y >= L) return false;
    return t[x + z * W + y * W * D] !== 0;
  };
  return { W, D, L, t, spawn, site, mesh, solid };
}

const R = 0.3;                      // player half-width
const H = [1.8, 1.2, 0.6];         // hitbox height: stand, crouch, prone
const EYE = [1.65, 1.1, 0.5];      // eye height per stance
const SPD = [4.5, 2.5, 1.2];       // walk speed per stance (m/s)
const SPRINT = 7, GRAVITY = 18, JUMP = 6.2, SENS = 0.002;

export function startGame({ role = "guest" } = {}) {
  const id = new URLSearchParams(location.search).get("map");   // ?map=id for quick testing
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

  const [sx, sy, sz] = G.spawn[role === "admin" ? 1 : 2] || [1.5, 1, 1.5];
  const p = { x: sx, y: sy, z: sz, vy: 0, yaw: 0, pitch: 0, stance: 0, eye: EYE[0], sprint: false, onGround: false };

  // True if a player-sized box at p (with height h) overlaps any solid cell.
  const hit = (h) => {
    for (let x = Math.floor(p.x - R); x <= Math.floor(p.x + R - 1e-4); x++)
      for (let z = Math.floor(p.z - R); z <= Math.floor(p.z + R - 1e-4); z++)
        for (let y = Math.floor(p.y); y <= Math.floor(p.y + h - 1e-4); y++)
          if (G.solid(x, y, z)) return true;
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
    if (e.code === "KeyC") setStance(p.stance === 1 ? 0 : 1);
    if (e.code === "KeyX") setStance(p.stance === 2 ? 0 : 2);
  });
  addEventListener("keyup", e => { keys[e.code] = false; });
  addEventListener("blur", () => { for (const k in keys) keys[k] = false; });

  function update(dt) {
    const mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), mz = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0);
    const moving = mx || mz;

    // Sprinting stands the player up first; if there is no room, no sprint.
    const wantSprint = (keys.ShiftLeft || keys.ShiftRight) && moving;
    if (wantSprint && p.stance) setStance(0);
    p.sprint = !!wantSprint && p.stance === 0;

    const s = Math.sin(p.yaw), c = Math.cos(p.yaw), l = Math.hypot(mx, mz) || 1;
    const step = (p.sprint ? SPRINT : SPD[p.stance]) * dt;
    const dx = (mx * c + mz * s) / l * step, dz = (-mx * s + mz * c) / l * step;
    p.x += dx; if (hit(H[p.stance])) p.x -= dx;   // axes resolved separately so walls slide
    p.z += dz; if (hit(H[p.stance])) p.z -= dz;

    if (keys.Space && p.onGround && p.stance === 0) p.vy = JUMP;
    p.vy -= GRAVITY * dt;
    p.y += p.vy * dt;
    if (hit(H[p.stance])) { p.y -= p.vy * dt; p.onGround = p.vy < 0; p.vy = 0; } else p.onGround = false;
    if (p.y < -10) { p.x = sx; p.y = sy; p.z = sz; p.vy = 0; }

    p.eye += (EYE[p.stance] - p.eye) * Math.min(1, dt * 12);
    cam.position.set(p.x, p.y + p.eye, p.z);
    cam.rotation.set(p.pitch, p.yaw, 0);
    if (hud) hud.textContent = ["standing", "crouching", "prone"][p.stance] + (p.sprint ? " (sprint)" : "") + (p.onGround ? "" : " (air)");
  }

  let last = performance.now();
  (function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    update(dt);
    renderer.render(scene, cam);
  })(last);
}

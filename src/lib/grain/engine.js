// Chunked falling-sand cellular automaton.
//
// The grid is split into 16x16 chunks. Each step only processes chunks that
// were woken during the previous step; any change to a cell wakes its chunk
// (and the neighbouring chunk when the cell sits on an edge or corner).
// Chunks where nothing happened go to sleep and cost nothing.

import {
  EMPTY, STONE, SAND, WATER, FIRE, ACID, GAS, WOOD, OIL, STEAM, SMOKE,
  DENS, MOV, LUT, FIRE_LUT, SPAWN_RATE, clamp8,
} from "./elements.js";

// ---------- rng (xorshift32) ----------
let seed = 0x9e3779b9;
export const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };

// ---------- world state ----------
export let W = 0, H = 0, N = 0, CW = 0, CH = 0;
export let act = new Uint8Array(0);   // chunks processed in the latest step
let nxt = new Uint8Array(0);          // chunks woken for the next step
let type, life, shade, clk, ctx, img, px;
let tick = 0;

export function initWorld(w, h, context) {
  W = w; H = h; N = W * H;
  CW = (W + 15) >> 4; CH = (H + 15) >> 4;
  type = new Uint8Array(N); life = new Uint8Array(N); shade = new Uint8Array(N); clk = new Uint8Array(N);
  act = new Uint8Array(CW * CH); nxt = new Uint8Array(CW * CH);
  ctx = context;
  ctx.canvas.width = W; ctx.canvas.height = H;
  img = ctx.createImageData(W, H); px = new Uint32Array(img.data.buffer);
  spawners.length = 0;
}

function wake(x, y) {
  const cx = x >> 4, cy = y >> 4, lx = x & 15, ly = y & 15;
  const ax = (lx === 0 && cx > 0) ? cx - 1 : cx, bx = (lx === 15 && cx < CW - 1) ? cx + 1 : cx;
  const ay = (ly === 0 && cy > 0) ? cy - 1 : cy, by = (ly === 15 && cy < CH - 1) ? cy + 1 : cy;
  for (let yy = ay; yy <= by; yy++) { const r = yy * CW; for (let xx = ax; xx <= bx; xx++) nxt[r + xx] = 1; }
}

export function initShade(t, x, y) {
  if (t === WOOD) return clamp8(Math.sin(y * 0.9 + Math.sin(x * 0.05) * 2) * 5 + 8 + rnd() * 3) & 15;
  return (rnd() * 16) | 0;
}

function put(x, y, t, l) {
  const i = y * W + x;
  type[i] = t; shade[i] = initShade(t, x, y);
  life[i] = l !== undefined ? l
    : t === FIRE ? 30 + rnd() * 30
    : t === STEAM ? 100 + rnd() * 110
    : t === SMOKE ? 50 + rnd() * 70 : 0;
  clk[i] = tick; wake(x, y);
}

function swap(i, j, x1, y1, x2, y2) {
  let a = type[i]; type[i] = type[j]; type[j] = a;
  a = life[i]; life[i] = life[j]; life[j] = a;
  a = shade[i]; shade[i] = shade[j]; shade[j] = a;
  clk[i] = tick; clk[j] = tick; wake(x1, y1); wake(x2, y2);
}

const canEnter = (t, u) => u === EMPTY || (MOV[u] === 1 && DENS[u] < DENS[t]);

// ---------- element rules ----------
// Falls straight, then diagonally. Returns true if it moved (or was held back by drag).
function fall(x, y, i, t) {
  if (y >= H - 1) return false;
  const b = i + W, u = type[b];
  if (canEnter(t, u)) {
    if (u !== EMPTY && rnd() < 0.45) { wake(x, y); return true; } // drag through liquid
    swap(i, b, x, y, x, y + 1); return true;
  }
  const d = rnd() < 0.5 ? -1 : 1;
  let nx = x + d;
  if (nx >= 0 && nx < W && canEnter(t, type[b + d])) { swap(i, b + d, x, y, nx, y + 1); return true; }
  nx = x - d;
  if (nx >= 0 && nx < W && canEnter(t, type[b - d])) { swap(i, b - d, x, y, nx, y + 1); return true; }
  return false;
}

function liquid(x, y, i, t) {
  if (t === OIL && rnd() < 0.35) { wake(x, y); return; } // oil is viscous
  if (fall(x, y, i, t)) return;
  const disp = t === WATER ? 5 : 3, d = rnd() < 0.5 ? -1 : 1;
  for (let p = 0; p < 2; p++) {
    const dir = p ? -d : d; let best = 0;
    for (let k = 1; k <= disp; k++) {
      const nx = x + dir * k; if (nx < 0 || nx >= W) break;
      const u = type[i + dir * k];
      if (u === EMPTY || (DENS[u] === 0 && MOV[u])) best = k; else break;
    }
    if (best) { swap(i, i + dir * best, x, y, x + dir * best, y); return; }
  }
}

const D4X = [0, 1, 0, -1], D4Y = [1, 0, -1, 0];
function acid(x, y, i) {
  const r = (rnd() * 4) | 0, nx = x + D4X[r], ny = y + D4Y[r];
  if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
    const u = type[ny * W + nx];
    const rate = u === SAND ? 0.12 : u === WOOD ? 0.08 : u === OIL ? 0.1 : u === STONE ? 0.015 : u === WATER ? 0.004 : 0;
    if (rate) {
      wake(x, y);
      if (rnd() < rate) {
        if (u === WATER) { put(x, y, WATER); return; }
        put(nx, ny, rnd() < 0.3 ? SMOKE : EMPTY);
        if (rnd() < 0.25) { put(x, y, EMPTY); return; }
      }
    }
  }
  liquid(x, y, i, ACID);
}

const D8X = [-1, 0, 1, -1, 1, -1, 0, 1], D8Y = [-1, -1, -1, 0, 0, 1, 1, 1];
function fire(x, y, i) {
  for (let k = 0; k < 8; k++) {
    const nx = x + D8X[k], ny = y + D8Y[k];
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const u = type[ny * W + nx];
    if (u === WATER) { if (rnd() < 0.3) put(nx, ny, STEAM); put(x, y, rnd() < 0.5 ? STEAM : EMPTY); return; }
    if (u === WOOD) { if (rnd() < 0.012) put(nx, ny, FIRE, 70 + rnd() * 60); }
    else if (u === OIL) { if (rnd() < 0.08) put(nx, ny, FIRE, 45 + rnd() * 30); }
    else if (u === GAS) { if (rnd() < 0.6) put(nx, ny, FIRE, 30 + rnd() * 16); }
  }
  const l = life[i] - 1;
  if (l <= 0) { put(x, y, rnd() < 0.2 ? SMOKE : EMPTY); return; }
  life[i] = l; wake(x, y);
  if (y > 0 && rnd() < 0.45) {
    const d = ((rnd() * 3) | 0) - 1, nx = x + d;
    if (nx >= 0 && nx < W && type[i - W + d] === EMPTY) swap(i, i - W + d, x, y, nx, y - 1);
  }
}

function gas(x, y, i, t) {
  if (t !== GAS) {
    const l = life[i] - 1;
    if (l <= 0) { put(x, y, (t === STEAM && rnd() < 0.35) ? WATER : EMPTY); return; }
    life[i] = l;
  }
  wake(x, y); // gases never settle
  const up = t === GAS ? 0.38 : t === STEAM ? 0.72 : 0.62, down = t === GAS ? 0.2 : 0.03;
  for (let a = 0; a < 2; a++) {
    const r = rnd(), dy = r < up ? -1 : r < up + down ? 1 : 0;
    const dx = dy === 0 ? (rnd() < 0.5 ? -1 : 1) : ((rnd() * 3) | 0) - 1;
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = ny * W + nx;
    if (type[j] === EMPTY) { swap(i, j, x, y, nx, ny); return; }
  }
}

function cell(x, y) {
  const i = y * W + x, t = type[i];
  if (t === EMPTY || t === STONE || t === WOOD) return;
  if (clk[i] === tick) return; // already moved this step
  clk[i] = tick;
  switch (t) {
    case SAND: fall(x, y, i, t); break;
    case WATER: case OIL: liquid(x, y, i, t); break;
    case ACID: acid(x, y, i); break;
    case FIRE: fire(x, y, i); break;
    default: gas(x, y, i, t);
  }
}

// ---------- spawners ----------
export const spawners = [];
export const MAX_SPAWNERS = 64;

function emit() {
  for (const s of spawners) {
    const rate = SPAWN_RATE[s.t];
    for (let k = 0; k < 3; k++) {
      const dx = ((rnd() * 5) | 0) - 2, dy = ((rnd() * 5) | 0) - 2;
      if (dx * dx + dy * dy > 5) continue;
      const x = s.x + dx, y = s.y + dy;
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      if (type[y * W + x] === EMPTY && rnd() < rate) put(x, y, s.t);
    }
  }
}

export function removeSpawners(x, y, r) {
  const rr = (r + 1) * (r + 1);
  for (let k = spawners.length - 1; k >= 0; k--) {
    const s = spawners[k], dx = s.x - x, dy = s.y - y;
    if (dx * dx + dy * dy <= rr) spawners.splice(k, 1);
  }
}

export function addSpawner(x, y, id, color) {
  if (x < 0 || x >= W || y < 0 || y >= H || id === EMPTY) return;
  removeSpawners(x, y, 2);
  if (spawners.length >= MAX_SPAWNERS) spawners.shift();
  spawners.push({ x, y, t: id, c: color });
}

// ---------- step ----------
export function step() {
  emit();
  tick = (tick + 1) & 255;
  const t = act; act = nxt; nxt = t; nxt.fill(0);
  for (let cy = CH - 1; cy >= 0; cy--) {
    const rb = cy * CW; let any = 0;
    for (let cx = 0; cx < CW; cx++) if (act[rb + cx]) { any = 1; break; }
    if (!any) continue;
    const y0 = cy << 4, y1 = Math.min(H, y0 + 16);
    for (let y = y1 - 1; y >= y0; y--) {
      const ltr = ((y + tick) & 1) === 0; // alternate sweep direction to avoid drift
      for (let k = 0; k < CW; k++) {
        const cx = ltr ? k : CW - 1 - k; if (!act[rb + cx]) continue;
        const x0 = cx << 4, x1 = Math.min(W, x0 + 16);
        if (ltr) for (let x = x0; x < x1; x++) cell(x, y);
        else for (let x = x1 - 1; x >= x0; x--) cell(x, y);
      }
    }
  }
}

// ---------- painting ----------
// id: element to paint (EMPTY erases). spawnersOnly: erase spawners without touching cells.
export function paint(gx, gy, id, r, dens, spawnersOnly = false) {
  if (id === EMPTY) removeSpawners(gx, gy, r);
  if (spawnersOnly) return;
  const rr = r * r + r * 0.3;
  for (let dy = -r; dy <= r; dy++) {
    const y = gy + dy; if (y < 0 || y >= H) continue;
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > rr) continue;
      const x = gx + dx; if (x < 0 || x >= W) continue;
      const i = y * W + x;
      if (id === EMPTY) { if (type[i]) put(x, y, EMPTY); }
      else if (type[i] === EMPTY && rnd() < dens) put(x, y, id);
    }
  }
}

export function clearWorld() {
  spawners.length = 0;
  type.fill(0); life.fill(0); shade.fill(0); act.fill(0); nxt.fill(0);
}

export function awakeCount() {
  let a = 0; for (let k = 0; k < act.length; k++) a += act[k];
  return a;
}

// ---------- starter scene ----------
function rect(x0, y0, x1, y1, t) {
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) put(x, y, t);
}
export function seedScene() {
  const L = Math.floor(W * 0.06), R = Math.floor(W * 0.46), top = H - Math.floor(H * 0.3), fl = H - 4;
  rect(L, fl - 2, R, fl, STONE); rect(L, top, L + 2, fl, STONE); rect(R - 2, top, R, fl, STONE);
  const wTop = top + Math.floor((fl - top) * 0.3);
  rect(L + 3, wTop + 5, R - 3, fl - 3, WATER);
  rect(L + 3, wTop, R - 3, wTop + 4, OIL);
  const pL = Math.floor(W * 0.56), pR = Math.floor(W * 0.9), py = Math.floor(H * 0.58);
  rect(pL, py, pR, py + 3, WOOD);
  const cx = (pL + pR) >> 1, ph = Math.min(Math.floor((pR - pL) * 0.3), Math.floor(H * 0.16));
  for (let h = 0; h < ph; h++) rect(cx - (ph - h), py - 1 - h, cx + (ph - h), py - 1 - h, SAND);
}

// ---------- rendering ----------
// Returns the number of non-empty cells.
export function render({ showChunks = false, hover = null, brush = 1, squareCursor = false } = {}) {
  let c = 0;
  for (let i = 0; i < N; i++) {
    const t = type[i];
    if (t === FIRE) { px[i] = FIRE_LUT[Math.min(255, life[i] * 3 + ((rnd() * 44) | 0))]; c++; }
    else { px[i] = LUT[(t << 4) | shade[i]]; if (t) c++; }
  }
  ctx.putImageData(img, 0, 0);

  if (showChunks) {
    ctx.lineWidth = 0.5;
    for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
      if (!act[cy * CW + cx]) continue;
      ctx.fillStyle = "rgba(255,206,110,.07)"; ctx.fillRect(cx * 16, cy * 16, 16, 16);
      ctx.strokeStyle = "rgba(255,206,110,.45)"; ctx.strokeRect(cx * 16 + 0.25, cy * 16 + 0.25, 15.5, 15.5);
    }
  }

  ctx.lineWidth = 0.8;
  for (const s of spawners) {
    ctx.fillStyle = "rgba(9,11,16,.55)"; ctx.fillRect(s.x - 2, s.y - 2, 5, 5);
    ctx.strokeStyle = s.c; ctx.strokeRect(s.x - 2.1, s.y - 2.1, 5.2, 5.2);
    ctx.fillStyle = "#fff"; ctx.fillRect(s.x, s.y, 1, 1);
  }

  if (hover) {
    ctx.lineWidth = 0.6; ctx.strokeStyle = "rgba(255,255,255,.55)";
    if (squareCursor) ctx.strokeRect(hover.x - 2.1, hover.y - 2.1, 5.2, 5.2);
    else { ctx.beginPath(); ctx.arc(hover.x + 0.5, hover.y + 0.5, Math.max(0.8, brush), 0, Math.PI * 2); ctx.stroke(); }
  }
  return c;
}

// UI wiring: toolbar, pointer input, keyboard, main loop.

import { EMPTY, FIRE, WOOD, TOOLS, LUT, FIRE_LUT, pack, elementCss } from "./elements.js";
import * as sim from "./engine.js";

// ---------- URL options (handy when embedding) ----------
// ?theme=dark|light   force the panel theme
// ?scene=empty        start with an empty world
const params = new URLSearchParams(location.search);
const theme = params.get("theme");
if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
const emptyStart = params.get("scene") === "empty";

// ---------- canvas ----------
const stage = document.getElementById("stage");
const cv = document.getElementById("sim");
const ctx = cv.getContext("2d");

function gridSize() {
  const sw = stage.clientWidth || 800, sh = stage.clientHeight || 600;
  const s = Math.max(2, Math.round(Math.sqrt(sw * sh / 85000))); // ~85k cells
  return [Math.max(64, Math.floor(sw / s)), Math.max(64, Math.floor(sh / s))];
}
function fit() {
  const sw = stage.clientWidth, sh = stage.clientHeight, s = Math.min(sw / sim.W, sh / sim.H);
  cv.style.width = sim.W * s + "px"; cv.style.height = sim.H * s + "px";
  cv.style.left = (sw - sim.W * s) / 2 + "px"; cv.style.top = (sh - sim.H * s) / 2 + "px";
}

// ---------- state ----------
let mode = "draw", tool = TOOLS[0], brush = 6;
let down = false, erasing = false, last = null, movedThisFrame = false, hover = null;
let paused = false, stepOnce = false, showChunks = false, particles = 0;

// ---------- painting ----------
function dab(x, y) {
  const id = erasing ? EMPTY : tool.id;
  const dens = brush <= 2 || id === EMPTY ? 1 : tool.dens;
  sim.paint(x, y, id, brush, dens, mode === "spawn");
}
function strokeTo(p) {
  if (!last) { dab(p.x, p.y); last = p; return; }
  const dx = p.x - last.x, dy = p.y - last.y;
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(1, brush * 0.5)));
  for (let k = 1; k <= n; k++) dab(Math.round(last.x + dx * k / n), Math.round(last.y + dy * k / n));
  last = p;
}
function toGrid(e) {
  const r = cv.getBoundingClientRect();
  return { x: Math.floor((e.clientX - r.left) / r.width * sim.W), y: Math.floor((e.clientY - r.top) / r.height * sim.H) };
}

const hint = document.getElementById("hint");
if (emptyStart) hint.textContent = "Pick an element and draw.";
stage.addEventListener("contextmenu", e => e.preventDefault());
stage.addEventListener("pointerdown", e => {
  stage.setPointerCapture(e.pointerId);
  down = true; erasing = e.button === 2; last = null;
  hint.classList.add("gone");
  const p = toGrid(e);
  hover = e.pointerType === "mouse" ? p : null;
  if (mode === "spawn" && !erasing && tool.id !== EMPTY) {
    sim.addSpawner(p.x, p.y, tool.id, elementCss(tool.id));
    down = false; return;
  }
  strokeTo(p); movedThisFrame = true;
});
stage.addEventListener("pointermove", e => {
  const p = toGrid(e);
  if (e.pointerType === "mouse") hover = p;
  if (down) { strokeTo(p); movedThisFrame = true; }
});
const endStroke = () => { down = false; erasing = false; last = null; };
stage.addEventListener("pointerup", endStroke);
stage.addEventListener("pointercancel", endStroke);
stage.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") hover = null; });

// ---------- toolbar ----------
const toolsEl = document.getElementById("tools"), descEl = document.getElementById("desc");
const btns = TOOLS.map(T => {
  const b = document.createElement("button");
  b.type = "button"; b.className = "tool"; b.title = `${T.name} (${T.key})`;
  b.style.setProperty("--el", elementCss(T.id));

  const c = document.createElement("canvas"); c.width = 5; c.height = 5;
  const g = c.getContext("2d"), id = g.createImageData(5, 5), p = new Uint32Array(id.data.buffer);
  for (let k = 0; k < 25; k++) {
    p[k] = T.id === FIRE ? FIRE_LUT[120 + ((sim.rnd() * 135) | 0)]
      : T.id === WOOD ? LUT[WOOD * 16 + sim.initShade(WOOD, k % 5, (k / 5) | 0)]
      : LUT[T.id * 16 + ((sim.rnd() * 16) | 0)];
  }
  if (T.id === EMPTY) for (let k = 0; k < 5; k++) p[k * 6] = pack(120, 128, 145);
  g.putImageData(id, 0, 0);

  const n = document.createElement("span"); n.textContent = T.name;
  const k = document.createElement("span"); k.className = "k"; k.textContent = T.key;
  b.append(c, n, k);
  b.addEventListener("click", () => select(T));
  toolsEl.append(b);
  return b;
});

function updateDesc() {
  if (mode === "draw") descEl.textContent = tool.d;
  else descEl.textContent = tool.id === EMPTY
    ? "Drag over spawners to remove them."
    : `Click to place a ${tool.name.toLowerCase()} spawner. It keeps pouring until you erase it.`;
}
function select(T) {
  tool = T;
  TOOLS.forEach((x, i) => btns[i].setAttribute("aria-pressed", x === T ? "true" : "false"));
  updateDesc();
}

const modeDraw = document.getElementById("modeDraw"), modeSpawn = document.getElementById("modeSpawn");
function setMode(m) {
  mode = m;
  modeDraw.setAttribute("aria-pressed", m === "draw" ? "true" : "false");
  modeSpawn.setAttribute("aria-pressed", m === "spawn" ? "true" : "false");
  updateDesc();
}
modeDraw.addEventListener("click", () => setMode("draw"));
modeSpawn.addEventListener("click", () => setMode("spawn"));

const size = document.getElementById("size"), sizeOut = document.getElementById("sizeOut");
function setBrush(v) { brush = Math.max(1, Math.min(24, v)); size.value = brush; sizeOut.textContent = brush; }
size.addEventListener("input", () => setBrush(+size.value));

const playBtn = document.getElementById("play"), stepBtn = document.getElementById("step");
function setPaused(p) { paused = p; playBtn.textContent = p ? "Play" : "Pause"; stepBtn.disabled = !p; }
playBtn.addEventListener("click", () => setPaused(!paused));
stepBtn.addEventListener("click", () => { stepOnce = true; });
document.getElementById("clear").addEventListener("click", sim.clearWorld);

const chunkBtn = document.getElementById("chunks");
function setChunks(v) { showChunks = v; chunkBtn.setAttribute("aria-pressed", v ? "true" : "false"); }
chunkBtn.addEventListener("click", () => setChunks(!showChunks));

addEventListener("keydown", e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const T = TOOLS.find(t => t.key === e.key);
  if (T) { select(T); return; }
  const k = e.key.toLowerCase();
  if (k === "[") setBrush(brush - 1);
  else if (k === "]") setBrush(brush + 1);
  else if (k === " ") { if (e.target.tagName === "BUTTON") return; e.preventDefault(); setPaused(!paused); }
  else if (k === "n") { if (paused) stepOnce = true; }
  else if (k === "v") setChunks(!showChunks);
  else if (k === "x") sim.clearWorld();
  else if (k === "s") setMode(mode === "draw" ? "spawn" : "draw");
});

// ---------- loop ----------
const fpsEl = document.getElementById("fps"), countEl = document.getElementById("count");
const awakeEl = document.getElementById("awake"), spawnEl = document.getElementById("spawnCount");
const DT = 1000 / 60; // fixed 60 Hz simulation
let prev = performance.now(), acc = 0, frames = 0, statT = prev;

function frame(now) {
  const dt = Math.min(100, now - prev); prev = now;
  if (down && !movedThisFrame && last) dab(last.x, last.y); // keep pouring while held
  movedThisFrame = false;

  if (!paused) {
    acc += dt; let n = 0;
    while (acc >= DT && n < 2) { sim.step(); acc -= DT; n++; }
    if (n === 2) acc = 0;
  } else if (stepOnce) { sim.step(); stepOnce = false; }

  particles = sim.render({
    showChunks, hover, brush,
    squareCursor: mode === "spawn" && tool.id !== EMPTY && !erasing,
  });

  frames++;
  if (now - statT >= 500) {
    fpsEl.textContent = Math.round(frames * 1000 / (now - statT)) + " fps";
    countEl.textContent = particles.toLocaleString();
    awakeEl.textContent = `${sim.awakeCount()} / ${sim.act.length}`;
    spawnEl.textContent = `${sim.spawners.length} / ${sim.MAX_SPAWNERS}`;
    frames = 0; statT = now;
  }
  requestAnimationFrame(frame);
}

// ---------- boot ----------
const [w, h] = gridSize();
sim.initWorld(w, h, ctx);
fit();
if (!emptyStart) sim.seedScene();
select(TOOLS[0]); setBrush(6);
new ResizeObserver(fit).observe(stage);
requestAnimationFrame(frame);

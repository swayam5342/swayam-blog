// Element ids, physical properties and colour tables.

export const EMPTY = 0, STONE = 1, SAND = 2, WATER = 3, FIRE = 4, ACID = 5,
  GAS = 6, WOOD = 7, OIL = 8, STEAM = 9, SMOKE = 10;
export const ELEMENT_COUNT = 11;

// Heavier elements sink through lighter movable ones.
export const DENS = new Uint8Array([0, 255, 20, 10, 0, 12, 0, 255, 8, 0, 0]);
// Whether an element can be displaced by something heavier.
export const MOV = new Uint8Array([1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1]);

// [r, g, b, shade jitter]
export const BASE = {
  [STONE]: [122, 128, 142, 12], [SAND]: [226, 190, 118, 16], [WATER]: [50, 116, 214, 10],
  [ACID]: [150, 230, 72, 16], [GAS]: [118, 100, 166, 10], [WOOD]: [126, 80, 42, 18],
  [OIL]: [78, 54, 28, 8], [STEAM]: [188, 202, 220, 12], [SMOKE]: [70, 72, 80, 8],
};
const EMPTY_COL = [16, 19, 26];

export const pack = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; // ABGR, little-endian
export const clamp8 = v => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

// 16 shades per element.
export const LUT = new Uint32Array(ELEMENT_COUNT * 16);
for (let t = 0; t < ELEMENT_COUNT; t++) for (let s = 0; s < 16; s++) {
  const b = BASE[t];
  if (!b) { LUT[t * 16 + s] = pack(...EMPTY_COL); continue; }
  const j = (s - 7.5) / 7.5 * b[3];
  LUT[t * 16 + s] = pack(clamp8(b[0] + j), clamp8(b[1] + j), clamp8(b[2] + j * 0.8));
}

// Fire colour by intensity 0..255.
export const FIRE_LUT = new Uint32Array(256);
{
  const st = [[0, [58, 14, 10]], [60, [150, 34, 16]], [130, [236, 92, 32]], [190, [255, 172, 60]], [255, [255, 242, 172]]];
  for (let i = 0; i < 256; i++) {
    let k = 0; while (st[k + 1][0] < i) k++;
    const [a, ca] = st[k], [b, cb] = st[k + 1], f = (i - a) / (b - a || 1);
    FIRE_LUT[i] = pack(clamp8(ca[0] + (cb[0] - ca[0]) * f), clamp8(ca[1] + (cb[1] - ca[1]) * f), clamp8(ca[2] + (cb[2] - ca[2]) * f));
  }
}

export function elementCss(id) {
  if (id === EMPTY) return "var(--dim)";
  if (id === FIRE) return "rgb(255,150,50)";
  return `rgb(${BASE[id].slice(0, 3).join(",")})`;
}

// Paintable tools. dens = fraction of brush cells filled per dab.
export const TOOLS = [
  { id: SAND,  name: "Sand",   key: "1", d: "Piles up and sinks through liquids.", dens: 0.35 },
  { id: WATER, name: "Water",  key: "2", d: "Flows, puts out fire, boils into steam.", dens: 0.45 },
  { id: FIRE,  name: "Fire",   key: "3", d: "Burns wood, oil and gas. Dies on its own.", dens: 0.3 },
  { id: ACID,  name: "Acid",   key: "4", d: "Eats sand, wood, oil and slowly stone. Water dilutes it.", dens: 0.4 },
  { id: GAS,   name: "Gas",    key: "5", d: "Drifts anywhere. Goes up in a flash near fire.", dens: 0.25 },
  { id: OIL,   name: "Oil",    key: "6", d: "Floats on water, flows slowly, burns fast.", dens: 0.4 },
  { id: WOOD,  name: "Wood",   key: "7", d: "Solid. Catches fire slowly.", dens: 1 },
  { id: STONE, name: "Stone",  key: "8", d: "Solid. Acid wears it down.", dens: 1 },
  { id: EMPTY, name: "Eraser", key: "9", d: "Clears cells. Right-click also erases.", dens: 1 },
];

// Per-frame emission probability for spawners.
export const SPAWN_RATE = {
  [SAND]: 0.5, [WATER]: 0.6, [FIRE]: 0.7, [ACID]: 0.5, [GAS]: 0.4, [OIL]: 0.5, [WOOD]: 0.3, [STONE]: 0.3,
};

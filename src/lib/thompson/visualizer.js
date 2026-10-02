// The Thompson NFA visualizer on /projects/thompson. Expects the globals
// `dagre` (graph layout) and `Go` (wasm_exec.js) to be loaded first.
import { JsEngine } from './js-engine.js';

function normalize(res) {
  if (res.graph) res.graph.edges = res.graph.edges || [];
  if (res.trace) {
    res.trace.input = res.trace.input || [];
    for (const s of res.trace.steps) { s.fired = s.fired || []; s.eps = s.eps || []; s.active = s.active || []; }
  }
  return res;
}

const WASM_URL = "/thompson/main.wasm";
let engine = null, engineName = "";

async function loadEngine() {
  try {
    if (typeof Go === "undefined" || typeof WebAssembly === "undefined") throw new Error("no WebAssembly support");
    const res = await fetch(WASM_URL);
    if (!res.ok) throw new Error("main.wasm: HTTP " + res.status);
    const go = new Go();
    const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), go.importObject);
    go.run(instance);
    for (let i = 0; i < 50 && !globalThis.thompson; i++) await new Promise((r) => setTimeout(r, 10));
    if (!globalThis.thompson) throw new Error("Go runtime did not start");
    engine = {
      compile: (p) => normalize(JSON.parse(globalThis.thompson.compile(p))),
      trace: (p, s) => normalize(JSON.parse(globalThis.thompson.trace(p, s))),
    };
    engineName = "Running the Go engine, compiled to WebAssembly.";
  } catch (e) {
    console.warn("Falling back to the JavaScript port:", e);
    engine = { compile: (p) => normalize(JsEngine.compile(p)), trace: (p, s) => normalize(JsEngine.trace(p, s)) };
    engineName = "This host can't run WebAssembly, so the page is using a JavaScript port of the Go engine.";
  }
}

/* =====================================================================
   Drawing the graph
   ===================================================================== */

const SVGNS = "http://www.w3.org/2000/svg";
const $ = (s) => document.querySelector(s);
function el(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
const isJunction = (n) => n.kind === "split" || n.kind === "empty";
const radius = (n, mini) => (isJunction(n) ? (mini ? 7 : 11) : mini ? 12 : 17);
const labelWidth = (s) => Array.from(s).length * 7.4 + 12;

function layoutGraph(graph, mini) {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "LR", nodesep: mini ? 12 : 20, ranksep: mini ? 18 : 30, edgesep: 10, marginx: mini ? 22 : 34, marginy: mini ? 12 : 22 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of graph.nodes) { const r = radius(n, mini); g.setNode(String(n.id), { width: 2 * r, height: 2 * r }); }
  for (const e of graph.edges) {
    const lab = e.epsilon ? { width: 0, height: 0 } : { width: labelWidth(e.label), height: 18, labelpos: "c" };
    g.setEdge(String(e.from), String(e.to), lab, String(e.id));
  }
  dagre.layout(g);
  const nodes = new Map(), edges = new Map();
  for (const n of graph.nodes) { const d = g.node(String(n.id)); nodes.set(n.id, { x: d.x, y: d.y, r: radius(n, mini) }); }
  for (const e of graph.edges) { const d = g.edge(String(e.from), String(e.to), String(e.id)); edges.set(e.id, { points: d.points, x: d.x, y: d.y }); }
  const gg = g.graph();
  return { width: gg.width, height: gg.height, nodes, edges };
}

function edgePath(points, a, b) {
  const p = points.map((q) => ({ x: q.x, y: q.y }));
  const clip = (c, toward, r) => {
    const dx = toward.x - c.x, dy = toward.y - c.y, L = Math.hypot(dx, dy) || 1;
    return { x: c.x + (dx / L) * r, y: c.y + (dy / L) * r };
  };
  p[0] = clip(a, p.length > 2 ? p[1] : b, a.r);
  p[p.length - 1] = clip(b, p.length > 2 ? p[p.length - 2] : a, b.r + 2);
  const f = (v) => v.toFixed(1);
  if (p.length < 3) return `M${f(p[0].x)},${f(p[0].y)}L${f(p[1].x)},${f(p[1].y)}`;
  let d = `M${f(p[0].x)},${f(p[0].y)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
    d += `C${f(p1.x + (p2.x - p0.x) / 6)},${f(p1.y + (p2.y - p0.y) / 6)} ${f(p2.x - (p3.x - p1.x) / 6)},${f(p2.y - (p3.y - p1.y) / 6)} ${f(p2.x)},${f(p2.y)}`;
  }
  return d;
}

let svgSeq = 0;
function drawGraph(svg, graph, mini) {
  const lay = layoutGraph(graph, mini);
  const pfx = "g" + ++svgSeq;
  svg.innerHTML = "";
  svg.setAttribute("viewBox", `0 0 ${lay.width} ${lay.height}`);
  svg.dataset.w = lay.width; svg.dataset.h = lay.height;
  if (mini) svg.classList.add("mini");

  const defs = el("defs", {}, svg);
  for (const kind of ["", "hot", "flow"]) {
    const m = el("marker", { id: `${pfx}-a${kind}`, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, markerUnits: "userSpaceOnUse", orient: "auto" }, defs);
    el("path", { d: "M0,1 L10,5 L0,9 z", class: "arrowhead " + kind }, m);
  }
  const blur = el("filter", { id: `${pfx}-glow`, x: "-60%", y: "-60%", width: "220%", height: "220%" }, defs);
  el("feGaussianBlur", { stdDeviation: 5 }, blur);

  const gEdges = el("g", {}, svg), gLabels = el("g", {}, svg), gNodes = el("g", {}, svg), gPulse = el("g", {}, svg);
  const edgeEls = new Map(), nodeEls = new Map();

  for (const e of graph.edges) {
    const L = lay.edges.get(e.id);
    const path = el("path", { d: edgePath(L.points, lay.nodes.get(e.from), lay.nodes.get(e.to)), class: "edge" + (e.epsilon ? " eps" : ""), "marker-end": `url(#${pfx}-a)` }, gEdges);
    let label = null;
    if (!e.epsilon) {
      const w = labelWidth(e.label);
      label = el("g", { class: "elabel", transform: `translate(${L.x},${L.y})` }, gLabels);
      el("rect", { x: -w / 2, y: -9, width: w, height: 18, rx: 4 }, label);
      el("text", {}, label).textContent = e.label;
    }
    edgeEls.set(e.id, { e, path, label });
  }
  for (const n of graph.nodes) {
    const P = lay.nodes.get(n.id);
    const g = el("g", { class: "state" + (isJunction(n) ? " junction" : ""), transform: `translate(${P.x},${P.y})` }, gNodes);
    if (!mini) el("circle", { r: P.r + 9, class: "halo", filter: `url(#${pfx}-glow)` }, g);
    el("circle", { r: P.r, class: "body" }, g);
    if (n.accept) el("circle", { r: P.r - 4, class: "ring" }, g);
    el("text", {}, g).textContent = n.id;
    nodeEls.set(n.id, g);
    if (n.start) el("line", { x1: -P.r - (mini ? 18 : 28), y1: 0, x2: -P.r - 2, y2: 0, class: "start-arrow", "marker-end": `url(#${pfx}-a)` }, g);
  }
  return { lay, pfx, edgeEls, nodeEls, gPulse };
}

function fitSvg(svg, wrap, opts = {}) {
  const w = +svg.dataset.w, h = +svg.dataset.h;
  const avail = wrap.clientWidth - 8;
  let s = Math.min(opts.max || 1.35, avail / w);
  if (opts.maxH && h * s > opts.maxH) s = opts.maxH / h;
  s = Math.max(opts.min || 0.6, s);
  svg.setAttribute("width", Math.round(w * s));
  svg.setAttribute("height", Math.round(h * s));
}

/* =====================================================================
   The player
   ===================================================================== */

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const S = { res: null, view: null, step: 0, playing: false, speed: 1, anim: null, hold: null };
const steps = () => S.res.trace.steps;
const last = () => steps().length - 1;

function setLamps(active, cls = "on") {
  const on = new Set(active);
  for (const [id, g] of S.view.nodeEls) { g.classList.toggle(cls, on.has(id)); }
}

function clearMotion() {
  for (const { path, label } of S.view.edgeEls.values()) {
    path.classList.remove("hot", "flow");
    path.setAttribute("marker-end", `url(#${S.view.pfx}-a)`);
    if (label) label.classList.remove("hot");
  }
  S.view.gPulse.innerHTML = "";
  for (const g of S.view.nodeEls.values()) g.classList.remove("was", "win");
}

function stopAnim() {
  if (S.anim) { cancelAnimationFrame(S.anim.raf); const r = S.anim.resolve; S.anim = null; r(false); }
}
function stopAll() {
  S.playing = false;
  if (S.hold) { clearTimeout(S.hold.t); S.hold.resolve(false); S.hold = null; }
  stopAnim();
  updateButtons();
}

function showStep(i) {
  stopAnim();
  S.step = i;
  clearMotion();
  setLamps(steps()[i].active);
  if (i === last() && S.res.trace.matched) S.view.nodeEls.get(S.res.graph.accept).classList.add("win");
  updateTape(i); updateNarration(i); updateLog(i); updateVerdict(i); updateButtons();
}

function edgeMarker(id, kind) {
  const { path, label } = S.view.edgeEls.get(id);
  path.classList.toggle("hot", kind === "hot");
  path.classList.toggle("flow", kind === "flow");
  path.setAttribute("marker-end", `url(#${S.view.pfx}-a${kind || ""})`);
  if (label) label.classList.toggle("hot", kind === "hot");
}

// Animate the transition into step i (from i-1, or from nothing for i = 0).
function animateTo(i) {
  stopAnim();
  if (reduceMotion) { showStep(i); return Promise.resolve(true); }
  const st = steps()[i], prev = i > 0 ? steps()[i - 1] : null;
  const G = S.res.graph, edgeById = new Map(G.edges.map((e) => [e.id, e]));
  S.step = i;
  clearMotion();
  updateTape(i); updateNarration(i); updateLog(i); updateVerdict(i, true); updateButtons();

  const T = 1000 / S.speed;
  const F = prev ? 0.42 * T : 0;
  const events = [], dots = [];

  if (prev) {
    setLamps([]); setLamps(prev.active, "was");
    for (const id of st.fired) {
      const e = edgeById.get(id);
      edgeMarker(id, "hot");
      dots.push({ id, t0: 0, t1: F, cls: "pulse" });
      events.push({ t: F, fn: () => { S.view.nodeEls.get(e.to).classList.add("on"); edgeMarker(id, ""); } });
    }
    events.push({ t: F, fn: () => { for (const g of S.view.nodeEls.values()) g.classList.remove("was"); } });
  } else {
    setLamps([G.start]);
  }

  // ε-closure spreads outward in waves; depth = number of ε hops.
  const depth = new Map();
  if (prev) for (const id of st.fired) depth.set(edgeById.get(id).to, 0); else depth.set(G.start, 0);
  let maxD = 0;
  const epsPlan = st.eps.map((id) => {
    const e = edgeById.get(id), d = (depth.get(e.from) ?? 0) + 1;
    depth.set(e.to, d); maxD = Math.max(maxD, d);
    return { id, e, d };
  });
  const W = maxD ? Math.min(0.2 * T, (0.55 * T) / maxD) : 0;
  for (const { id, e, d } of epsPlan) {
    const t0 = F + (d - 1) * W, t1 = F + d * W;
    events.push({ t: t0, fn: () => edgeMarker(id, "flow") });
    dots.push({ id, t0, t1, cls: "pulse flow" });
    events.push({ t: t1, fn: () => S.view.nodeEls.get(e.to).classList.add("on") });
  }
  const end = F + maxD * W + (st.active.length ? 140 : 0.25 * T);
  events.sort((a, b) => a.t - b.t);

  for (const d of dots) { d.path = S.view.edgeEls.get(d.id).path; d.len = d.path.getTotalLength(); }

  return new Promise((resolve) => {
    const t0 = performance.now();
    let ei = 0;
    const frame = (now) => {
      const t = now - t0;
      while (ei < events.length && events[ei].t <= t) events[ei++].fn();
      for (const d of dots) {
        if (t < d.t0 || t > d.t1) { if (d.c) { d.c.remove(); d.c = null; } continue; }
        if (!d.c) d.c = el("circle", { r: 4.5, class: d.cls }, S.view.gPulse);
        const p = d.path.getPointAtLength(d.len * Math.min(1, (t - d.t0) / Math.max(1, d.t1 - d.t0)));
        d.c.setAttribute("cx", p.x); d.c.setAttribute("cy", p.y);
      }
      if (t >= end) { S.anim = null; showStep(i); resolve(true); return; }
      S.anim.raf = requestAnimationFrame(frame);
    };
    S.anim = { raf: requestAnimationFrame(frame), resolve };
  });
}

function hold(ms) {
  return new Promise((resolve) => { S.hold = { t: setTimeout(() => { S.hold = null; resolve(true); }, ms), resolve }; });
}

async function play() {
  if (!S.res || !S.res.trace) return;
  if (S.step >= last()) { showStep(0); }
  S.playing = true; updateButtons();
  if (S.step === 0 && !S.anim) { if (!(await animateTo(0))) return; if (!S.playing) return; await hold(350 / S.speed); }
  while (S.playing && S.step < last()) {
    const ok = await animateTo(S.step + 1);
    if (!ok || !S.playing) return;
    if (S.step < last() && !(await hold(380 / S.speed))) return;
  }
  S.playing = false; updateButtons();
}

/* ---------- tape ---------- */
const LEAD = 40, CELL = 38;
const shown = (ch) => ({ " ": "␣", "\n": "\\n", "\t": "\\t", "\r": "\\r" }[ch] ?? ch);
function buildTape() {
  const tape = $("#tn-tape"); tape.innerHTML = "";
  const input = S.res && S.res.trace ? S.res.trace.input : [];
  const frame = (ch, k) => {
    const f = document.createElement("div");
    f.className = "frame" + (ch === null ? " leader" : "");
    const bits = ch === null ? 0 : ch.codePointAt(0) & 0xff;
    // 8-level tape: channels 8..4, the small feed hole, then channels 3..1
    for (const b of [7, 6, 5, 4, 3, -1, 2, 1, 0]) {
      const h = document.createElement("i");
      h.className = b < 0 ? "hole feed" : "hole" + (bits >> b & 1 ? " punched" : "");
      f.appendChild(h);
    }
    const g = document.createElement("span"); g.className = "glyph"; g.textContent = ch === null ? "" : shown(ch);
    f.appendChild(g);
    if (ch !== null) { f.dataset.k = k; f.title = `Jump to after character ${k + 1}`; }
    tape.appendChild(f);
  };
  for (let i = 0; i < LEAD; i++) frame(null);
  input.forEach((ch, k) => frame(ch, k));
  for (let i = 0; i < LEAD; i++) frame(null);
}
function updateTape(i) {
  const tape = $("#tn-tape"), win = $("#tn-tape-window");
  const pos = i - 1; // index of the character just read
  const x = win.clientWidth / 2 - (LEAD + pos + 0.5) * CELL;
  tape.style.transform = `translateX(${x}px)`;
  const tr = S.res.trace, dead = tr.deadAt >= 0 && i === last();
  tape.querySelectorAll(".frame[data-k]").forEach((f) => {
    const k = +f.dataset.k;
    f.classList.toggle("read", k <= pos);
    f.classList.toggle("current", k === pos);
    f.classList.toggle("skipped", dead && k > tr.deadAt);
  });
}

/* ---------- narration ---------- */
function listIds(ids) {
  if (ids.length === 1) return String(ids[0]);
  return ids.slice(0, -1).join(", ") + " and " + ids[ids.length - 1];
}
function setText(ids) { return ids.length ? `{${[...ids].sort((a, b) => a - b).join(", ")}}` : "{}"; }
function updateNarration(i) {
  const tr = S.res.trace, G = S.res.graph, st = tr.steps[i], n = tr.input.length;
  const kind = new Map(G.nodes.map((x) => [x.id, x.kind]));
  const reads = (id) => ["rune", "any", "class"].includes(kind.get(id));
  const q = (ch) => `<code>${escapeHTML(shown(ch))}</code>`;
  const endText = () => tr.matched
    ? ` That was the last character, and accepting state ${G.accept} is lit, so the string matches.`
    : ` That was the last character, and accepting state ${G.accept} is dark, so there is no match.`;
  let s;
  if (i === 0) {
    const a = st.active.length;
    s = a === 1
      ? `Before reading anything, the machine starts in state ${G.start}. No ε-arrows lead out of it, so that is the only lamp lit.`
      : `Before reading anything, the machine starts in state ${G.start} and takes every ε-arrow it can reach for free. It is now in ${a} states at once: ${setText(st.active)}.`;
    if (n === 0) s += tr.matched ? ` The input is empty and accepting state ${G.accept} is already lit, so the empty string matches.` : ` The input is empty and accepting state ${G.accept} is dark, so there is no match.`;
  } else {
    const prev = tr.steps[i - 1], from = st.fired.map((e) => e >> 1), ch = q(st.rune);
    s = `Read ${ch}, character ${st.pos + 1} of ${n}. `;
    if (!st.active.length) {
      s += `None of the lit states has an arrow for ${ch}, so every lamp goes out. An empty set can never light up again, so the input is rejected without reading the rest.`;
    } else {
      s += from.length === 1 ? `State ${from[0]} has an arrow for ${ch} and moves along it.` : `States ${listIds(from)} have arrows for ${ch} and all move along them together.`;
      const dark = prev.active.filter((id) => reads(id) && !from.includes(id));
      if (dark.length) s += ` ${dark.length === 1 ? "State" : "States"} ${listIds(dark)} can't read ${ch} and ${dark.length === 1 ? "goes" : "go"} dark.`;
      s += st.eps.length ? ` After following ε-arrows, the machine is in ${setText(st.active)}.` : ` The machine is now in ${setText(st.active)}.`;
      if (i === last()) s += endText();
    }
  }
  $("#tn-narration").innerHTML = s;
}
function escapeHTML(s) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

/* ---------- lamp log ---------- */
const LOG_LBL = 30, LOG_CELL = 14;
function buildLog() {
  const log = $("#tn-log"), tr = S.res.trace, G = S.res.graph;
  const cols = tr.steps.length;
  const grid = document.createElement("div");
  grid.className = "log-grid";
  grid.style.gridTemplateColumns = `${LOG_LBL - 2}px repeat(${cols}, 12px)`;
  const sets = tr.steps.map((s) => new Set(s.active));
  let html = `<div></div><div class="hd" title="start">·</div>`;
  for (let c = 1; c < cols; c++) html += `<div class="hd">${escapeHTML(shown(tr.steps[c].rune))}</div>`;
  for (const n of G.nodes) {
    html += `<div class="lbl${isJunction(n) ? "" : " cons"}">${n.id}</div>`;
    for (let c = 0; c < cols; c++) html += `<div class="c${sets[c].has(n.id) ? " on" : ""}${n.accept ? " acc" : ""}" data-s="${c}"></div>`;
  }
  grid.innerHTML = html + `<div class="log-future"></div><div class="log-cursor"></div>`;
  log.innerHTML = ""; log.appendChild(grid);
}
function updateLog(i) {
  const fut = $("#tn-log .log-future"), cur = $("#tn-log .log-cursor");
  if (!fut) return;
  const x = LOG_LBL + i * LOG_CELL;
  cur.style.left = x + "px";
  fut.style.left = x + LOG_CELL - 1 + "px";
}

/* ---------- verdict, buttons ---------- */
function updateVerdict(i, running) {
  const v = $("#tn-verdict"), tr = S.res.trace, n = tr.input.length;
  let cls = "idle", txt;
  if (i === last() && !running) { cls = tr.matched ? "match" : "nomatch"; txt = tr.matched ? "Match" : "No match"; }
  else if (i === last()) { txt = "Finishing"; }
  else txt = i === 0 ? `Ready, ${n} character${n === 1 ? "" : "s"} to read` : `Read ${i} of ${n}`;
  v.className = "verdict " + cls; v.querySelector("span").textContent = txt;
}
const ICON_PLAY = '<svg viewBox="0 0 12 12"><path d="M2 1v10l9-5z"/></svg>Play';
const ICON_PAUSE = '<svg viewBox="0 0 12 12"><rect x="1.5" y="1" width="3" height="10"/><rect x="7.5" y="1" width="3" height="10"/></svg>Pause';
function updateButtons() {
  const ok = !!(S.res && S.res.trace);
  const atEnd = ok && S.step >= last();
  $("#tn-b-play").innerHTML = S.playing ? ICON_PAUSE : atEnd ? ICON_PLAY.replace("Play", "Replay") : ICON_PLAY;
  $("#tn-b-play").disabled = !ok;
  $("#tn-b-back").disabled = !ok || S.step === 0;
  $("#tn-b-reset").disabled = !ok || (S.step === 0 && !S.playing);
  $("#tn-b-step").disabled = !ok || atEnd;
}

/* =====================================================================
   Wiring
   ===================================================================== */

function compileAndShow({ autoplay } = {}) {
  stopAll();
  const p = $("#tn-pattern").value, s = $("#tn-input").value;
  const res = engine.trace(p, s);
  const err = $("#tn-pattern-error"), wrap = $("#tn-graph-wrap");
  if (res.error) {
    $("#tn-pattern").setAttribute("aria-invalid", "true");
    err.textContent = res.pos >= 0 ? `${p}\n${" ".repeat(res.pos)}^ ${res.error}` : res.error;
    wrap.classList.add("stale");
    return;
  }
  $("#tn-pattern").removeAttribute("aria-invalid");
  err.textContent = "";
  wrap.classList.remove("stale");
  S.res = res;
  S.view = drawGraph($("#tn-graph"), res.graph, false);
  fitSvg($("#tn-graph"), wrap, { maxH: 470, max: 1.6 });
  buildTape(); buildLog();
  showStep(0);
  history.replaceState(null, "", "#" + new URLSearchParams({ p, s }).toString());
  if (autoplay && !reduceMotion) setTimeout(play, 450);
}

const PRESETS = [
  ["(a|b)*abb", "babaabb", "the textbook example"],
  ["colou?r", "colour", "optional letter"],
  ["(0|1(01*0)*1)*", "1001", "binary multiples of 3"],
  ["[a-z]+@[a-z]+\\.(com|org)", "ken@bell.com", "classes and escapes"],
  ["a?a?a?a?a?aaaaa", "aaaaa", "Russ Cox's benchmark"],
  ["(x+x+)+y", "xxxxxxxxxxxxxxxxxxxx", "the backtracking trap"],
];

function loadPreset(p, s) {
  $("#tn-pattern").value = p; $("#tn-input").value = s;
  compileAndShow({ autoplay: true });
}

function drawFigures() {
  const figs = [
    ["a", "One state that reads <code>a</code>. Its arrow is left loose until something follows it."],
    ["ab", "Concatenation aims the first fragment's loose arrow at the second fragment's start."],
    ["a|b", "Alternation adds a junction with an ε-arrow into each branch."],
    ["a*", "Star adds a junction that either enters the loop or leaves it."],
    ["a+", "Plus runs the fragment once, then the junction decides whether to go round again."],
    ["a?", "Question mark is a junction that can skip the fragment."],
  ];
  const box = $("#tn-figs");
  box.innerHTML = "";
  for (const [pat, cap] of figs) {
    const fig = document.createElement("figure");
    const wrap = document.createElement("div"); wrap.className = "graph";
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("role", "img"); svg.setAttribute("aria-label", `State machine for ${pat}`);
    wrap.appendChild(svg); fig.appendChild(wrap);
    const fc = document.createElement("figcaption");
    fc.innerHTML = `<code>${pat}</code> ${cap}`;
    fig.appendChild(fc); box.appendChild(fig);
    const res = engine.compile(pat);
    drawGraph(svg, res.graph, true);
    fitSvg(svg, wrap, { max: 1.1, min: 0.5 });
  }
}

let debounce;
function onEdit() { clearTimeout(debounce); debounce = setTimeout(() => compileAndShow({ autoplay: false }), 220); }

// Keyboard shortcuts only apply while the machine is on screen, so Space
// and Home/End keep scrolling the page when you're reading the article.
function machineInView() {
  const r = $(".tn-machine").getBoundingClientRect();
  return r.bottom > 80 && r.top < innerHeight - 80;
}

export async function boot() {
  await loadEngine();
  $("#tn-engine").textContent = engineName;

  const box = $("#tn-presets");
  for (const [p, s, d] of PRESETS) {
    const b = document.createElement("button");
    b.className = "preset";
    b.innerHTML = `<code>${escapeHTML(p)}</code><small>${d}</small>`;
    b.addEventListener("click", () => loadPreset(p, s));
    box.appendChild(b);
  }
  $("#tn-load-trap").addEventListener("click", () => {
    loadPreset("(x+x+)+y", "xxxxxxxxxxxxxxxxxxxx");
    $(".tn-machine").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  });

  $("#tn-pattern").addEventListener("input", onEdit);
  $("#tn-input").addEventListener("input", onEdit);
  $("#tn-b-play").addEventListener("click", () => (S.playing ? stopAll() : play()));
  $("#tn-b-step").addEventListener("click", () => { const i = S.step; stopAll(); if (i < last()) animateTo(i + 1); });
  $("#tn-b-back").addEventListener("click", () => { const i = S.step; stopAll(); showStep(Math.max(0, i - 1)); });
  $("#tn-b-reset").addEventListener("click", () => { stopAll(); showStep(0); });
  $("#tn-speed").addEventListener("input", (e) => { S.speed = +e.target.value; $("#tn-speed-out").textContent = S.speed + "×"; });
  $("#tn-tape").addEventListener("click", (e) => {
    const f = e.target.closest(".frame[data-k]"); if (!f || !S.res) return;
    const target = +f.dataset.k + 1;
    if (target <= last()) { stopAll(); showStep(target); }
  });
  $("#tn-log").addEventListener("click", (e) => {
    const c = e.target.closest(".c"); if (!c) return;
    stopAll(); showStep(+c.dataset.s);
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select") || !S.res || e.metaKey || e.ctrlKey || e.altKey || !machineInView()) return;
    if (e.key === " " && e.target.matches("button")) return; // let the focused button handle Space
    if (e.key === " ") { e.preventDefault(); S.playing ? stopAll() : play(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); $("#tn-b-step").click(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); $("#tn-b-back").click(); }
    else if (e.key === "Home") { e.preventDefault(); $("#tn-b-reset").click(); }
    else if (e.key === "End") { e.preventDefault(); stopAll(); showStep(last()); }
  });
  new ResizeObserver(() => {
    if (!S.res) return;
    fitSvg($("#tn-graph"), $("#tn-graph-wrap"), { maxH: 470, max: 1.6 });
    $("#tn-tape").style.transition = "none"; updateTape(S.step);
    requestAnimationFrame(() => ($("#tn-tape").style.transition = ""));
  }).observe($("#tn-graph-wrap"));

  const h = new URLSearchParams(location.hash.slice(1));
  $("#tn-pattern").value = h.has("p") ? h.get("p") : PRESETS[0][0];
  $("#tn-input").value = h.has("s") ? h.get("s") : PRESETS[0][1];
  drawFigures();
  compileAndShow({ autoplay: true });
}

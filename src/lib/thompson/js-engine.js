// Line-for-line JavaScript port of the Go engine (parse.go, nfa.go, match.go,
// graph.go in github.com/swayam5342/thompson). The page uses it only when the
// browser can't run WebAssembly. It returns the same JSON shapes as the Go
// build's thompson.compile / thompson.trace.
export const JsEngine = (() => {
  const PERL = { d: [[48, 57]], w: [[48, 57], [65, 90], [95, 95], [97, 122]], s: [[9, 10], [12, 13], [32, 32]] };
  const MAXR = 0x10ffff, MAX_STATES = 20000;
  class SyntaxErr extends Error { constructor(msg, pos) { super(msg); this.pos = pos; } }
  const cp = (c) => c.codePointAt(0);
  const chr = (r) => String.fromCodePoint(r);

  function complement(rs) {
    const s = [...rs].sort((a, b) => a[0] - b[0]); const out = []; let next = 0;
    for (const [lo, hi] of s) { if (lo > next) out.push([next, lo - 1]); if (hi + 1 > next) next = hi + 1; }
    if (next <= MAXR) out.push([next, MAXR]);
    return out;
  }

  function parse(pattern) {
    const src = Array.from(pattern); let pos = 0;
    const more = () => pos < src.length, peek = () => src[pos];
    const err = (p, m) => { throw new SyntaxErr(m, p); };
    function alt() { let l = concat(); while (more() && peek() === "|") { pos++; l = { k: "alt", l, r: concat() }; } return l; }
    function concat() {
      let res = null;
      while (more() && peek() !== "|" && peek() !== ")") { const n = repeat(); res = res ? { k: "cat", l: res, r: n } : n; }
      return res || { k: "empty" };
    }
    function repeat() {
      let n = atom();
      while (more()) {
        const c = peek();
        if (c === "*") n = { k: "star", l: n }; else if (c === "+") n = { k: "plus", l: n };
        else if (c === "?") n = { k: "quest", l: n }; else return n;
        pos++;
      }
      return n;
    }
    function atom() {
      const start = pos, c = peek();
      switch (c) {
        case "(": { pos++; const inner = alt(); if (!more() || peek() !== ")") err(start, "missing ')' for this '('"); pos++; return inner; }
        case "*": case "+": case "?": err(start, `nothing before '${c}' to repeat`);
        case ".": pos++; return { k: "any" };
        case "[": return { k: "class", cls: klass() };
        case "\\": { const e = escape(); if (e.cls) { e.cls.label = src.slice(start, pos).join(""); return { k: "class", cls: e.cls }; } return { k: "lit", r: e.r }; }
      }
      pos++; return { k: "lit", r: cp(c) };
    }
    function escape() {
      const start = pos; pos++;
      if (!more()) err(start, "trailing backslash");
      const c = peek(); pos++;
      switch (c) {
        case "n": return { r: 10 }; case "t": return { r: 9 }; case "r": return { r: 13 };
        case "d": case "D": case "w": case "W": case "s": case "S":
          return { cls: { ranges: PERL[c.toLowerCase()], negate: c !== c.toLowerCase(), label: "" } };
      }
      if (/[\p{L}\p{Nd}]/u.test(c)) err(start, `unknown escape '\\${c}'`);
      return { r: cp(c) };
    }
    function klass() {
      const start = pos; pos++;
      const cls = { ranges: [], negate: false, label: "" };
      if (more() && peek() === "^") { cls.negate = true; pos++; }
      let first = true;
      for (;;) {
        if (!more()) err(start, "missing ']' for this '['");
        if (peek() === "]" && !first) { pos++; break; }
        first = false;
        const a = classAtom();
        if (a.ranges) { cls.ranges.push(...a.ranges); continue; }
        const lo = a.r; let hi = lo;
        if (pos + 1 < src.length && peek() === "-" && src[pos + 1] !== "]") {
          const dash = pos; pos++;
          const b = classAtom();
          if (b.ranges) err(dash, "a range can't end in a class escape");
          hi = b.r;
          if (hi < lo) err(dash, `range ${chr(lo)}-${chr(hi)} is backwards`);
        }
        cls.ranges.push([lo, hi]);
      }
      cls.label = src.slice(start, pos).join("");
      return cls;
    }
    function classAtom() {
      if (peek() !== "\\") { const r = cp(peek()); pos++; return { r }; }
      const e = escape();
      if (!e.cls) return { r: e.r };
      return { ranges: e.cls.negate ? complement(e.cls.ranges) : e.cls.ranges };
    }
    const n = alt();
    if (more()) err(pos, "unmatched ')'");
    return n;
  }

  function compile(pattern) {
    const ast = parse(pattern), states = [];
    const ns = (kind) => { const s = { id: states.length, kind, r: 0, cls: null, out: -1, out1: -1 }; states.push(s); return s; };
    const patch = (f, t) => { for (const [s, k] of f.out) s[k] = t; };
    const KIND = { lit: "rune", any: "any", class: "class" };
    function build(n) {
      switch (n.k) {
        case "lit": case "any": case "class": { const s = ns(KIND[n.k]); s.r = n.r || 0; s.cls = n.cls || null; return { start: s.id, out: [[s, "out"]] }; }
        case "empty": { const s = ns("empty"); return { start: s.id, out: [[s, "out"]] }; }
        case "cat": { const a = build(n.l), b = build(n.r); patch(a, b.start); return { start: a.start, out: b.out }; }
        case "alt": { const a = build(n.l), b = build(n.r); const s = ns("split"); s.out = a.start; s.out1 = b.start; return { start: s.id, out: [...a.out, ...b.out] }; }
        case "star": { const e = build(n.l); const s = ns("split"); s.out = e.start; patch(e, s.id); return { start: s.id, out: [[s, "out1"]] }; }
        case "plus": { const e = build(n.l); const s = ns("split"); s.out = e.start; patch(e, s.id); return { start: e.start, out: [[s, "out1"]] }; }
        case "quest": { const e = build(n.l); const s = ns("split"); s.out = e.start; return { start: s.id, out: [...e.out, [s, "out1"]] }; }
      }
    }
    const f = build(ast), acc = ns("match");
    patch(f, acc.id);
    if (states.length > MAX_STATES) throw new Error(`regex: pattern ${JSON.stringify(pattern)} needs ${states.length} states, limit is ${MAX_STATES}`);
    // renumber depth-first from the start state
    const newID = new Array(states.length).fill(-1), order = [], stack = [f.start];
    while (stack.length) {
      const id = stack.pop();
      if (id < 0 || newID[id] >= 0) continue;
      newID[id] = order.length; const s = states[id]; order.push(s); stack.push(s.out1, s.out);
    }
    const remap = (id) => (id < 0 ? -1 : newID[id]);
    const start = remap(f.start), accept = remap(acc.id); // before ids are rewritten below
    for (const s of order) { s.id = remap(s.id); s.out = remap(s.out); s.out1 = remap(s.out1); }
    return { pattern, states: order, start, accept };
  }

  const displayRune = (r) => ({ 32: "␣", 10: "\\n", 9: "\\t", 13: "\\r" }[r] ?? chr(r));
  function label(s) {
    if (s.kind === "rune") return displayRune(s.r);
    if (s.kind === "any") return ".";
    if (s.kind === "class") return s.cls.label;
    return "ε";
  }
  function consumes(s, r) {
    if (s.kind === "rune") return s.r === r;
    if (s.kind === "any") return r !== 10;
    if (s.kind === "class") { const inR = s.cls.ranges.some(([lo, hi]) => lo <= r && r <= hi); return inR !== s.cls.negate; }
    return false;
  }

  function graph(n) {
    const g = { pattern: n.pattern, start: n.start, accept: n.accept, nodes: [], edges: [] };
    for (const s of n.states) {
      const node = { id: s.id, kind: s.kind };
      if (s.id === n.start) node.start = true;
      if (s.id === n.accept) node.accept = true;
      g.nodes.push(node);
      const eps = s.kind === "split" || s.kind === "empty";
      [s.out, s.out1].forEach((to, slot) => { if (to >= 0) g.edges.push({ id: s.id * 2 + slot, from: s.id, to, label: label(s), epsilon: eps }); });
    }
    return g;
  }

  function trace(n, input) {
    const mark = new Array(n.states.length).fill(-1); let gen = 0, eps = [];
    const add = (list, id, via) => {
      if (id < 0 || mark[id] === gen) return;
      mark[id] = gen; if (via >= 0) eps.push(via); list.push(id);
      const s = n.states[id];
      if (s.kind === "split") { add(list, s.out, id * 2); add(list, s.out1, id * 2 + 1); }
      else if (s.kind === "empty") add(list, s.out, id * 2);
    };
    const t = { pattern: n.pattern, input: [], steps: [], matched: false, deadAt: -1 };
    let clist = []; add(clist, n.start, -1);
    t.steps.push({ pos: -1, rune: "", fired: [], eps, active: [...clist] }); eps = [];
    let pos = 0;
    for (const ch of input) {
      t.input.push(ch);
      if (t.deadAt >= 0) { pos++; continue; }
      gen++; const nlist = [], fired = [], r = cp(ch);
      for (const id of clist) { const s = n.states[id]; if (consumes(s, r)) { fired.push(id * 2); add(nlist, s.out, -1); } }
      clist = nlist;
      t.steps.push({ pos, rune: ch, fired, eps, active: [...clist] }); eps = [];
      if (!clist.length) t.deadAt = pos;
      pos++;
    }
    if (t.deadAt < 0) t.matched = clist.includes(n.accept);
    return t;
  }

  function run(pattern, input) {
    let n;
    try { n = compile(pattern); }
    catch (e) { return { error: e.message, pos: e instanceof SyntaxErr ? e.pos : -1 }; }
    const out = { graph: graph(n), pos: 0 };
    if (input !== undefined) out.trace = trace(n, input);
    return out;
  }
  return { compile: (p) => run(p), trace: (p, s) => run(p, s) };
})();

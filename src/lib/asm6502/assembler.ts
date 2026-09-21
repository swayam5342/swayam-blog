// A small two-pass 6502 assembler. Pure TypeScript, no dependencies, so it
// runs unchanged in Node and in the browser.
//
// Syntax (the same dialect asm/*.asm already uses):
//   ORG $0600            set the assembly address (also `.org`, or `* = $0600`)
//   NAME = expr          define a constant (must be resolvable at that point)
//   label:               define a label at the current address
//   LDA #<label          instructions; operand modes as usual; `A` = accumulator
//   .byte 1, "text", 0   data (`.db`); `.word` / `.dw` = 16-bit little-endian
//   .ascii / .asciiz     strings (`.asciiz` appends a 0 byte)
//   .fill count[, value] repeat a byte
//   ; comment
//
// Expressions: numbers ($hex, 0xhex, %bin, decimal, 'c'), symbols, `*` (the
// current address), + - * / & | ^ << >> ~, unary - < > (low / high byte,
// binding tighter than binary operators: write `#<(MSG+1)`), and parentheses.
// Symbols are case-sensitive; mnemonics and directives are not.
//
// Sizing of forward references: a symbol not yet defined on pass 1 is assumed
// to be a 16-bit address, so `LDA later` becomes absolute even if `later`
// turns out to live in zero page. (Backward references and constants defined
// above the use pick zero page when the value fits.)

import { OPCODES, type Mode } from './opcodes.ts';

export interface Diagnostic { line: number; message: string }
export interface Segment { addr: number; bytes: number[] }
export interface ListingLine { line: number; addr: number; bytes: number[]; source: string }
export interface AssembleResult {
  ok: boolean;
  segments: Segment[];
  listing: ListingLine[];
  symbols: Record<string, number>;
  errors: Diagnostic[];
  /** Address of the first emitted byte, or null if nothing was emitted. */
  entry: number | null;
}

/** Where code goes when the source has no ORG (the emulator's default load address). */
export const DEFAULT_ORIGIN = 0x0200;

class AsmError extends Error {}

// ---------------------------------------------------------------------------
// Scanning helpers
// ---------------------------------------------------------------------------

/** Yields [index, char, depth] for every character outside quotes; depth is the paren nesting outside the char. */
function* scanTop(s: string): Generator<[number, string, number]> {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '"' || ch === "'") {
      for (i++; i < s.length && s[i] !== ch; i++) if (s[i] === '\\') i++;
      continue;
    }
    if (ch === '(') { yield [i, ch, depth]; depth++; continue; }
    if (ch === ')') depth--;
    yield [i, ch, depth];
  }
}

function stripComment(s: string): string {
  for (const [i, ch] of scanTop(s)) if (ch === ';') return s.slice(0, i);
  return s;
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const [i, ch, depth] of scanTop(s)) {
    if (ch === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out;
}

/** Index of the ')' matching the '(' at s[0], or -1. */
function matchParen(s: string): number {
  for (const [i, ch, depth] of scanTop(s)) if (ch === ')' && depth === 0) return i;
  return -1;
}

const ESCAPES: Record<string, number> = { n: 10, r: 13, t: 9, '0': 0, '\\': 92, "'": 39, '"': 34 };

function unescape(ch: string): number {
  const v = ESCAPES[ch];
  if (v === undefined) throw new AsmError(`unknown escape '\\${ch}'`);
  return v;
}

function parseString(item: string): number[] {
  if (item.length < 2 || item[item.length - 1] !== '"') throw new AsmError('unterminated string');
  const out: number[] = [];
  for (let i = 1; i < item.length - 1; i++) {
    let c = item[i]!;
    if (c === '"') throw new AsmError('unexpected text after string');
    let code: number;
    if (c === '\\') { i++; c = item[i]!; code = unescape(c); } else code = c.charCodeAt(0);
    if (code > 0xff) throw new AsmError(`character '${c}' does not fit in a byte`);
    out.push(code);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

type Tok = { k: 'num'; n: number } | { k: 'id'; s: string } | { k: 'op'; s: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === ' ' || c === '\t') { i++; continue; }
    const rest = src.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^\$([0-9a-fA-F]+)/.exec(rest))) out.push({ k: 'num', n: parseInt(m[1]!, 16) });
    else if ((m = /^0[xX]([0-9a-fA-F]+)/.exec(rest))) out.push({ k: 'num', n: parseInt(m[1]!, 16) });
    else if ((m = /^%([01]+)/.exec(rest))) out.push({ k: 'num', n: parseInt(m[1]!, 2) });
    else if ((m = /^\d+/.exec(rest))) out.push({ k: 'num', n: parseInt(m[0], 10) });
    else if ((m = /^'(\\.|[^'\\])'/.exec(rest))) {
      const body = m[1]!;
      out.push({ k: 'num', n: body[0] === '\\' ? unescape(body[1]!) : body.charCodeAt(0) });
    } else if ((m = /^[A-Za-z_]\w*/.exec(rest))) out.push({ k: 'id', s: m[0] });
    else if ((m = /^(<<|>>|[-+*/&|^~<>()])/.exec(rest))) out.push({ k: 'op', s: m[0] });
    else throw new AsmError(`unexpected character '${c}'`);
    i += m[0].length;
  }
  return out;
}

interface Ctx {
  symbols: Map<string, number>;
  pc: number;
  /** Pass 2: an undefined symbol is an error instead of a forward reference. */
  final: boolean;
}

interface Eval { value: number; unresolved: boolean }

function evalExpr(src: string, ctx: Ctx): Eval {
  const toks = tokenize(src);
  if (toks.length === 0) throw new AsmError('missing expression');
  let pos = 0;
  let unresolved = false;

  const accept = (...ops: string[]): string | null => {
    const t = toks[pos];
    if (t && t.k === 'op' && ops.includes(t.s)) { pos++; return t.s; }
    return null;
  };

  const binary = (next: () => number, ops: string[], apply: (op: string, a: number, b: number) => number) => (): number => {
    let v = next();
    for (let op = accept(...ops); op; op = accept(...ops)) v = apply(op, v, next());
    return v;
  };

  const primary = (): number => {
    const t = toks[pos++];
    if (!t) throw new AsmError('unexpected end of expression');
    if (t.k === 'num') return t.n;
    if (t.k === 'id') {
      const v = ctx.symbols.get(t.s);
      if (v !== undefined) return v;
      if (ctx.final) throw new AsmError(`undefined symbol '${t.s}'`);
      unresolved = true;
      return 0;
    }
    if (t.s === '*') return ctx.pc;
    if (t.s === '(') {
      const v = or();
      if (!accept(')')) throw new AsmError("missing ')'");
      return v;
    }
    throw new AsmError(`unexpected '${t.s}'`);
  };

  const unary = (): number => {
    if (accept('-')) return -unary();
    if (accept('~')) return ~unary();
    if (accept('<')) return unary() & 0xff;
    if (accept('>')) return (unary() >> 8) & 0xff;
    return primary();
  };

  const mul = binary(unary, ['*', '/'], (op, a, b) => {
    if (op === '*') return a * b;
    if (b === 0) { if (unresolved) return 0; throw new AsmError('division by zero'); }
    return Math.trunc(a / b);
  });
  const add = binary(mul, ['+', '-'], (op, a, b) => (op === '+' ? a + b : a - b));
  const shift = binary(add, ['<<', '>>'], (op, a, b) => (op === '<<' ? a << b : a >> b));
  const and = binary(shift, ['&'], (_, a, b) => a & b);
  const xor = binary(and, ['^'], (_, a, b) => a ^ b);
  const or: () => number = binary(xor, ['|'], (_, a, b) => a | b);

  const value = or();
  if (pos < toks.length) {
    const t = toks[pos]!;
    throw new AsmError(`unexpected '${t.k === 'num' ? t.n : t.s}' in expression`);
  }
  return { value, unresolved };
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

type Operand =
  | { kind: 'none' }
  | { kind: 'acc' }
  | { kind: 'imm' | 'ind' | 'izx' | 'izy'; expr: string }
  | { kind: 'mem'; expr: string; index: '' | 'x' | 'y' };

function parseOperand(text: string): Operand {
  const t = text.trim();
  if (t === '') return { kind: 'none' };
  if (/^a$/i.test(t)) return { kind: 'acc' };
  if (t[0] === '#') return { kind: 'imm', expr: t.slice(1) };

  if (t[0] === '(') {
    const close = matchParen(t);
    if (close !== -1) {
      const inner = t.slice(1, close);
      const after = t.slice(close + 1).trim();
      if (after === '') {
        const parts = splitTop(inner);
        if (parts.length === 2 && /^\s*x\s*$/i.test(parts[1]!)) return { kind: 'izx', expr: parts[0]! };
        if (parts.length === 1) return { kind: 'ind', expr: inner };
        throw new AsmError('bad indirect operand');
      }
      if (/^,\s*y$/i.test(after)) {
        if (splitTop(inner).length !== 1) throw new AsmError('bad indirect operand');
        return { kind: 'izy', expr: inner };
      }
      // Otherwise the parentheses just group part of an ordinary expression.
    }
  }

  const parts = splitTop(t);
  if (parts.length === 1) return { kind: 'mem', expr: t, index: '' };
  if (parts.length === 2) {
    const idx = parts[1]!.trim().toLowerCase();
    if (idx === 'x' || idx === 'y') return { kind: 'mem', expr: parts[0]!, index: idx };
  }
  throw new AsmError('unexpected \',\' in operand (indexing is ",X" or ",Y")');
}

const MODE_NAMES: Record<string, string> = {
  imp: 'implied', acc: 'accumulator', imm: 'immediate', ind: 'indirect', izx: '(zp,X)', izy: '(zp),Y',
  zp: 'zero page', abs: 'absolute', zpx: 'zero page,X', abx: 'absolute,X', zpy: 'zero page,Y', aby: 'absolute,Y',
};

function encodeInstruction(
  mn: string, operandText: string, ctx: Ctx, prior: Mode | undefined,
): { bytes: number[]; mode: Mode } {
  const ops = OPCODES[mn]!;
  const opd = parseOperand(operandText);

  const has = (m: Mode): boolean => ops[m] !== undefined;
  const require = (m: Mode): Mode => {
    if (!has(m)) throw new AsmError(`${mn} does not support ${MODE_NAMES[m]} addressing`);
    return m;
  };

  let mode: Mode;
  let expr: string | undefined;
  switch (opd.kind) {
    case 'none':
      if (has('imp')) mode = 'imp';
      else if (has('acc')) mode = 'acc';
      else throw new AsmError(`${mn} needs an operand`);
      break;
    case 'acc': mode = require('acc'); break;
    case 'imm': mode = require('imm'); expr = opd.expr; break;
    case 'ind': mode = require('ind'); expr = opd.expr; break;
    case 'izx': mode = require('izx'); expr = opd.expr; break;
    case 'izy': mode = require('izy'); expr = opd.expr; break;
    case 'mem': {
      expr = opd.expr;
      if (opd.index === '' && has('rel')) { mode = 'rel'; break; }
      const zp: Mode = opd.index === '' ? 'zp' : opd.index === 'x' ? 'zpx' : 'zpy';
      const ab: Mode = opd.index === '' ? 'abs' : opd.index === 'x' ? 'abx' : 'aby';
      if (!has(zp) && !has(ab)) {
        throw new AsmError(`${mn} does not support ${MODE_NAMES[ab]} addressing`);
      }
      if (prior) { mode = prior; break; }
      if (has(zp) && has(ab)) {
        const r = evalExpr(expr, ctx);
        mode = !r.unresolved && r.value >= 0 && r.value <= 0xff ? zp : ab;
      } else mode = has(zp) ? zp : ab;
      break;
    }
  }

  const op = ops[mode]!;
  if (expr === undefined) return { bytes: [op], mode };

  const { value } = evalExpr(expr, ctx);
  const range = (lo: number, hi: number, what: string): void => {
    if (ctx.final && (value < lo || value > hi)) throw new AsmError(`${what}: ${value} is out of range (${lo}..${hi})`);
  };
  switch (mode) {
    case 'imm': range(-128, 255, 'immediate value'); return { bytes: [op, value & 0xff], mode };
    case 'zp': case 'zpx': case 'zpy': case 'izx': case 'izy':
      range(0, 0xff, 'zero page address'); return { bytes: [op, value & 0xff], mode };
    case 'rel': {
      const offset = value - (ctx.pc + 2);
      if (ctx.final && (offset < -128 || offset > 127)) {
        throw new AsmError(`branch target is ${offset} bytes away (limit -128..127)`);
      }
      return { bytes: [op, offset & 0xff], mode };
    }
    default:
      range(0, 0xffff, 'address'); return { bytes: [op, value & 0xff, (value >> 8) & 0xff], mode };
  }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export function assemble(source: string): AssembleResult {
  const lines = source.split(/\r?\n/);
  const symbols = new Map<string, number>();
  const choices = new Map<number, Mode>();
  const errors: Diagnostic[] = [];
  const seen = new Set<string>();
  const segments: Segment[] = [];
  const listing: ListingLine[] = [];

  const report = (line: number, message: string): void => {
    const key = `${line}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    errors.push({ line, message });
  };

  for (const pass of [1, 2] as const) {
    let pc = DEFAULT_ORIGIN;
    let cur: Segment | null = null;

    lines.forEach((raw, idx) => {
      const lineNo = idx + 1;
      const startPc = pc;
      let lineBytes: number[] = [];
      const ctx = (): Ctx => ({ symbols, pc, final: pass === 2 });
      const resolved = (expr: string, what: string): number => {
        const r = evalExpr(expr, ctx());
        if (r.unresolved) throw new AsmError(`${what} must use symbols defined earlier in the file`);
        return r.value;
      };
      const define = (name: string, value: number): void => {
        if (pass !== 1) return;
        if (/^[axy]$/i.test(name)) throw new AsmError(`'${name}' is a register name and cannot be a symbol`);
        if (symbols.has(name)) throw new AsmError(`symbol '${name}' is already defined`);
        symbols.set(name, value);
      };
      const emit = (bytes: number[]): void => {
        if (pc + bytes.length > 0x10000) throw new AsmError('program runs past $FFFF');
        lineBytes = bytes;
        if (pass === 2 && bytes.length) {
          if (!cur || cur.addr + cur.bytes.length !== pc) { cur = { addr: pc, bytes: [] }; segments.push(cur); }
          cur.bytes.push(...bytes);
        }
        pc += bytes.length;
      };
      const setOrigin = (expr: string): void => {
        const v = resolved(expr, 'ORG');
        if (v < 0 || v > 0xffff) throw new AsmError(`ORG address ${v} is out of range`);
        pc = v;
      };

      try {
        let text = stripComment(raw).trim();

        for (let m = /^([A-Za-z_]\w*)\s*:/.exec(text); m; m = /^([A-Za-z_]\w*)\s*:/.exec(text)) {
          define(m[1]!, pc);
          text = text.slice(m[0].length).trim();
        }

        let m: RegExpExecArray | null;
        if ((m = /^\*\s*=(?!=)\s*(.*)$/.exec(text))) {
          setOrigin(m[1]!);
        } else if ((m = /^([A-Za-z_]\w*)\s*=(?!=)\s*(.*)$/.exec(text))) {
          if (pass === 1) define(m[1]!, resolved(m[2]!, `value of '${m[1]}'`));
        } else if (text !== '') {
          const wm = /^(\.?[A-Za-z_]\w*)\s*(.*)$/.exec(text);
          if (!wm) throw new AsmError(`cannot parse '${text}'`);
          const word = wm[1]!.toUpperCase();
          const operand = wm[2]!.trim();

          switch (word) {
            case 'ORG': case '.ORG':
              if (operand === '') throw new AsmError('ORG needs an address');
              setOrigin(operand);
              break;
            case '.BYTE': case '.DB': case '.ASCII': case '.ASCIIZ': {
              if (operand === '') throw new AsmError(`${wm[1]} needs at least one value`);
              const bytes: number[] = [];
              for (const part of splitTop(operand)) {
                const item = part.trim();
                if (item === '') throw new AsmError('empty item in data list');
                if (item[0] === '"') bytes.push(...parseString(item));
                else {
                  const v = evalExpr(item, ctx()).value;
                  if (pass === 2 && (v < -128 || v > 255)) throw new AsmError(`byte value ${v} is out of range (-128..255)`);
                  bytes.push(v & 0xff);
                }
              }
              if (word === '.ASCIIZ') bytes.push(0);
              emit(bytes);
              break;
            }
            case '.WORD': case '.DW': {
              if (operand === '') throw new AsmError(`${wm[1]} needs at least one value`);
              const bytes: number[] = [];
              for (const part of splitTop(operand)) {
                const v = evalExpr(part.trim(), ctx()).value;
                if (pass === 2 && (v < -32768 || v > 0xffff)) throw new AsmError(`word value ${v} is out of range`);
                bytes.push(v & 0xff, (v >> 8) & 0xff);
              }
              emit(bytes);
              break;
            }
            case '.FILL': {
              const parts = splitTop(operand);
              if (parts.length < 1 || parts.length > 2 || parts[0]!.trim() === '') throw new AsmError('.fill needs a count and optional value');
              const n = resolved(parts[0]!, '.fill count');
              if (n < 0 || n > 0x10000) throw new AsmError(`.fill count ${n} is out of range`);
              const v = parts.length === 2 ? evalExpr(parts[1]!.trim(), ctx()).value : 0;
              emit(new Array<number>(n).fill(v & 0xff));
              break;
            }
            default:
              if (!Object.hasOwn(OPCODES, word)) throw new AsmError(`unknown instruction or directive '${wm[1]}'`);
              {
                const r = encodeInstruction(word, operand, ctx(), choices.get(idx));
                if (pass === 1) choices.set(idx, r.mode);
                emit(r.bytes);
              }
          }
        }
      } catch (e) {
        if (!(e instanceof AsmError)) throw e;
        report(lineNo, e.message);
      }

      if (pass === 2) listing.push({ line: lineNo, addr: startPc, bytes: lineBytes, source: raw });
    });
  }

  return {
    ok: errors.length === 0,
    segments,
    listing,
    symbols: Object.fromEntries(symbols),
    errors,
    entry: segments.length ? segments[0]!.addr : null,
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');

/** Standard Intel HEX (16-byte data records + EOF), loadable by the emulator's `.hex` loader. */
export function toIntelHex(segments: Segment[]): string {
  const out: string[] = [];
  for (const seg of segments) {
    for (let off = 0; off < seg.bytes.length; off += 16) {
      const chunk = seg.bytes.slice(off, off + 16);
      const addr = seg.addr + off;
      const rec = [chunk.length, (addr >> 8) & 0xff, addr & 0xff, 0, ...chunk];
      const sum = -rec.reduce((a, b) => a + b, 0) & 0xff;
      out.push(':' + [...rec, sum].map(hex2).join(''));
    }
  }
  out.push(':00000001FF');
  return out.join('\n') + '\n';
}

/** Human-readable listing: address, bytes, source. */
export function formatListing(listing: ListingLine[]): string {
  return listing.map((l) => {
    const addr = l.bytes.length ? l.addr.toString(16).toUpperCase().padStart(4, '0') : '    ';
    const bytes = l.bytes.slice(0, 4).map(hex2).join(' ') + (l.bytes.length > 4 ? '…' : '');
    return `${addr}  ${bytes.padEnd(12)} ${l.source}`;
  }).join('\n');
}

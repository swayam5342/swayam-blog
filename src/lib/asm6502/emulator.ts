// Thin typed wrapper around the Emscripten build of the 6502 emulator
// (public/emu6502/emu6502.mjs, built from the emulator repo's wasm/ folder).
import type { Segment } from './assembler.ts';

export interface Regs {
  a: number;
  x: number;
  y: number;
  sp: number;
  pc: number;
  status: number;
  cycles: number;
}

interface WasmModule {
  HEAPU8: Uint8Array;
  _malloc(n: number): number;
  cwrap(name: string, ret: string | null, args: string[]): (...a: number[]) => number;
}

const MEM_SIZE = 0x10000;

export class Emulator {
  private readonly m: WasmModule;
  private readonly staging: number;
  private readonly fn: Record<string, (...a: number[]) => number>;

  private constructor(m: WasmModule) {
    this.m = m;
    this.staging = m._malloc(MEM_SIZE);
    const w = (name: string, args: string[] = [], ret: string | null = 'number') => m.cwrap(name, ret, args);
    const n = 'number';
    this.fn = {
      init: w('emu_init', [], null),
      load: w('emu_load', [n, n, n], null),
      reset: w('emu_reset', [n], null),
      run: w('emu_run', [n]),
      runCycles: w('emu_run_cycles', [n]),
      halted: w('emu_halted'),
      key: w('emu_key', [n], null),
      outPtr: w('emu_out_ptr'),
      outLen: w('emu_out_len'),
      outClear: w('emu_out_clear', [], null),
      mem: w('emu_mem'),
      a: w('emu_a'), x: w('emu_x'), y: w('emu_y'), sp: w('emu_sp'), pc: w('emu_pc'),
      status: w('emu_status'), cycles: w('emu_cycles'),
    };
    this.fn.init!();
  }

  static async create(): Promise<Emulator> {
    const url = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/emu6502/emu6502.mjs`;
    // The glue lives in public/, which Vite's dev server refuses to serve for a
    // rewritten `import()` (it appends "?import" and answers 500). Going through
    // Function keeps the URL untouched in dev; production is unaffected.
    const load = new Function('u', 'return import(u)') as (u: string) => Promise<{ default: () => Promise<unknown> }>;
    const mod = await load(new URL(url, location.href).href);
    return new Emulator((await mod.default()) as WasmModule);
  }

  /** Wipe the machine (RAM, devices, input FIFO), load the segments and point the CPU at `entry`. */
  loadProgram(segments: Segment[], entry: number): void {
    this.fn.init!();
    for (const seg of segments) {
      this.m.HEAPU8.set(seg.bytes, this.staging);
      this.fn.load!(this.staging, seg.bytes.length, seg.addr);
    }
    this.fn.reset!(entry);
  }

  get halted(): boolean { return this.fn.halted!() === 1; }

  /** Run whole instructions until at least `budget` cycles are used or the program halts. Returns cycles used. */
  runCycles(budget: number): number { return this.fn.runCycles!(budget); }

  /** Execute exactly one instruction. */
  step(): void { this.fn.run!(1); }

  pushKey(byte: number): void { this.fn.key!(byte & 0xff); }

  /** Bytes the program wrote to the console port since the last call. */
  drainOutput(): Uint8Array {
    const len = this.fn.outLen!();
    if (len === 0) return new Uint8Array(0);
    const ptr = this.fn.outPtr!();
    const out = this.m.HEAPU8.slice(ptr, ptr + len);
    this.fn.outClear!();
    return out;
  }

  regs(): Regs {
    const f = this.fn;
    return { a: f.a!(), x: f.x!(), y: f.y!(), sp: f.sp!(), pc: f.pc!(), status: f.status!(), cycles: f.cycles!() };
  }

  /** Copy of one 256-byte page of RAM (raw bytes; device registers are not consulted). */
  page(n: number): Uint8Array {
    const base = this.fn.mem!() + (n & 0xff) * 256;
    return this.m.HEAPU8.slice(base, base + 256);
  }
}

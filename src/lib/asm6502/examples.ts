import helloAsm from './examples/print_string.asm?raw';
import fibonacciAsm from './examples/fibonacci.asm?raw';
import calculatorAsm from './examples/calculator.asm?raw';
import echoAsm from './examples/echo.asm?raw';
import timerAsm from './examples/timer_ticks.asm?raw';

export interface Example {
  id: string;
  name: string;
  source: string;
  /** Memory page to show first (a program's results usually land somewhere specific). */
  page: number;
}

// The fibonacci and calculator programs read their inputs from zero page. In
// the playground there is no debugger to poke them, so each example ends with
// an ORG block that puts the inputs there as part of the assembled image.
const withInputs = (src: string, block: string): string => `${src.trimEnd()}\n\n${block}\n`;

export const EXAMPLES: Example[] = [
  { id: 'hello', name: 'Hello — print a string', page: 0x09, source: helloAsm },
  {
    id: 'fibonacci', name: 'Fibonacci', page: 0x00,
    source: withInputs(fibonacciAsm, `; --- playground setup: input placed in zero page ---
        ORG COUNT
        .byte 10        ; how many terms to compute (1-13); results appear at $20`),
  },
  {
    id: 'calculator', name: 'Calculator (7 × 6)', page: 0x00,
    source: withInputs(calculatorAsm, `; --- playground setup: inputs placed in zero page ---
        ORG OP_A
        .byte 7, 6, 2   ; OP_A, OP_B, OPERATOR (0 = +, 1 = -, 2 = *, 3 = /); result in $03/$04`),
  },
  { id: 'echo', name: 'Echo keyboard input', page: 0x03, source: echoAsm },
  { id: 'timer', name: 'Timer interrupts', page: 0x00, source: timerAsm },
];

; ---------------------------------------------------------------------------
; 4-function 8-bit calculator for the 6502 emulator in this repo.
;
; There is no keyboard/screen device emulated, so I/O goes through fixed
; zero-page memory locations instead -- poke the inputs with the debugger's
; 'w' command, run it, then read the result with 'm':
;
;   $00  operand A (0-255)
;   $01  operand B (0-255)
;   $02  operator: 0=ADD, 1=SUB, 2=MUL, 3=DIV
;   $03  result: low byte (ADD/SUB: 8-bit sum/difference;
;                           MUL: low byte of 16-bit product;
;                           DIV: quotient)
;   $04  result: high byte (ADD/SUB: always 0;
;                            MUL: high byte of 16-bit product;
;                            DIV: remainder)
;   $05  error flag: 1 if DIV was attempted with B=0, else 0
;
; ADD/SUB wrap modulo 256 (no overflow flag exposed -- check carry yourself
; via the debugger's flag display if you need it). SUB does not clamp
; negative results; it's ordinary two's-complement wraparound.
;
; The program halts by jumping to itself (DONE: JMP DONE) -- the debugger's
; 'c' (continue) command detects this self-loop and stops automatically.
;
; Assemble/load: this file is documentation of ../rom/calculator.hex, which
; is the byte-for-byte hand assembly of this source, loadable directly via
; `emu6502 rom/calculator.hex`.
; ---------------------------------------------------------------------------

ORG $0600

OP_A    = $00
OP_B    = $01
OPERATOR= $02
RES_LO  = $03
RES_HI  = $04
ERR     = $05

START:  LDA OPERATOR
        CMP #0
        BEQ DO_ADD
        CMP #1
        BEQ DO_SUB
        CMP #2
        BEQ DO_MUL
        CMP #3
        BEQ DO_DIV
        JMP DONE            ; unknown operator: do nothing, halt

; --- ADD: RES = A + B (8-bit wraparound, RES_HI always 0) -----------------
DO_ADD: LDA OP_A
        CLC
        ADC OP_B
        STA RES_LO
        LDA #0
        STA RES_HI
        JMP DONE

; --- SUB: RES = A - B (8-bit wraparound, RES_HI always 0) -----------------
DO_SUB: LDA OP_A
        SEC
        SBC OP_B
        STA RES_LO
        LDA #0
        STA RES_HI
        JMP DONE

; --- MUL: RES = A * B (16-bit product via repeated addition) --------------
DO_MUL: LDA #0
        STA RES_LO
        STA RES_HI
        LDX OP_B
        BEQ MUL_DONE        ; B=0 -> result already 0
MUL_LOOP:
        LDA RES_LO
        CLC
        ADC OP_A
        STA RES_LO
        LDA RES_HI
        ADC #0
        STA RES_HI
        DEX
        BNE MUL_LOOP
MUL_DONE:
        JMP DONE

; --- DIV: RES_LO = A / B, RES_HI = A % B (repeated subtraction) -----------
DO_DIV: LDA OP_B
        BNE DIV_OK
        LDA #1
        STA ERR             ; division by zero
        JMP DONE
DIV_OK: LDX #0              ; quotient
        LDA OP_A            ; running remainder
DIV_LOOP:
        CMP OP_B
        BCC DIV_END         ; remainder < divisor -> done
        SEC
        SBC OP_B
        INX
        JMP DIV_LOOP
DIV_END:
        STA RES_HI          ; remainder
        STX RES_LO          ; quotient
        JMP DONE

DONE:   JMP DONE             ; trap: 'continue' in the debugger stops here

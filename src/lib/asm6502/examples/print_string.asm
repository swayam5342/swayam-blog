; ---------------------------------------------------------------------------
; Print a fixed string to the console.
;
; Demonstrates: absolute-indexed addressing to walk a byte array (LDA
; MSG,X), a null-terminated string as inline data sharing the program's
; address space (the CPU never executes it -- DONE's self-loop is reached
; first -- but LDA can still read it), and using the console output
; register ($FF00) introduced for the echo example, here driven by code
; instead of by hand.
;
; No inputs needed -- just load and run; MSG prints once, then halts.
; ---------------------------------------------------------------------------

        ORG $0900

OUT     = $FF00

        LDX #0
LOOP:   LDA MSG,X
        BEQ DONE        ; null terminator -- done
        STA OUT
        INX
        JMP LOOP

DONE:   JMP DONE

MSG:    .byte "6502", 0

; ---------------------------------------------------------------------------
; Fibonacci sequence generator.
;
; Demonstrates: indexed addressing (STA $addr,X) to fill an array, a
; fixed-count loop (CPX/BNE), and using the stack (PHA/PLA) as scratch
; storage for a value that doesn't fit in a free register.
;
; Computes the first N Fibonacci numbers (1,1,2,3,5,8,13,...) into $20
; onward, where N is read from memory at $12 -- poke it with the debugger's
; 'w' command BEFORE running (e.g. 'w 12 0a' for 10 terms; 'pc 0700' then
; 'c'). This is not optional: $12 defaults to 0 after reset, and leaving it
; unset does not just run long and harmlessly stop. STA OUT,X is zero-page
; indexed addressing, which wraps *within* page zero on real 6502 hardware,
; so once X passes $F2 the array writes start overwriting PREV/CURR/COUNT
; themselves ($20 + $F2 wraps to $12) -- COUNT gets clobbered with a stray
; Fibonacci byte mid-run, and the loop stops at an unpredictable X having
; scribbled garbage across a chunk of zero page. Valid range is 1-13: the
; 14th term, 377, would overflow a byte. Halts by jumping to itself, same
; convention as every other example here -- the debugger's 'c' stops there
; automatically.
;
; $10  scratch: "prev" value while computing
; $11  scratch: "curr" value while computing
; $12  input: how many terms to compute (1-13) -- MUST be set before running
; $20-$2C  the (up to 13) computed Fibonacci numbers, in order
; ---------------------------------------------------------------------------

ORG $0700

COUNT   = $12
PREV    = $10
CURR    = $11
OUT     = $20

        LDA #0
        STA PREV        ; prev = 0
        LDA #1
        STA CURR        ; curr = 1
        LDX #0

LOOP:   LDA CURR
        STA OUT,X       ; array[X] = curr
        CLC
        LDA PREV
        ADC CURR        ; A = prev + curr (the next term)
        PHA             ; stash it -- both PREV and CURR need updating
                         ; before we can use it, and there's no spare register
        LDA CURR
        STA PREV        ; prev = curr
        PLA
        STA CURR        ; curr = (the stashed next term)
        INX
        CPX COUNT       ; zero-page compare -- COUNT is a variable, not a constant
        BNE LOOP

DONE:   JMP DONE

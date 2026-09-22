; ---------------------------------------------------------------------------
; Keyboard echo.
;
; Demonstrates: polling the console input port. $FF01 bit 0 says whether a
; key is waiting; reading $FF02 pops it. Whatever you type is written straight
; back out to $FF00. Typing '!' ends the program.
; ---------------------------------------------------------------------------

        ORG $0300

IN_STATUS = $FF01
IN_DATA   = $FF02
OUT       = $FF00

LOOP:   LDA IN_STATUS
        AND #1
        BEQ LOOP        ; nothing waiting -- keep polling
        LDA IN_DATA
        STA OUT         ; echo it
        CMP #'!'
        BNE LOOP

DONE:   JMP DONE

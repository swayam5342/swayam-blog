; ---------------------------------------------------------------------------
; Timer interrupts.
;
; Demonstrates: the countdown timer at $FF10-$FF13 firing an IRQ. The main
; program just waits; each time the timer fires, the interrupt handler prints
; a '.' and bumps a counter. After TICKS interrupts the program stops the timer
; and halts.
;
; The timer counts CPU cycles, so at the playground's "1 MHz" speed the dots
; come about 65 ms apart ($FFFF cycles). Pick the slow speed to watch them.
;
; $10  number of interrupts handled so far
; ---------------------------------------------------------------------------

        ORG $0300

TICKS     = 10
COUNT     = $10
OUT       = $FF00
TIMER_LO  = $FF10
TIMER_HI  = $FF11
TIMER_CTL = $FF12
TIMER_ACK = $FF13

        LDA #0
        STA COUNT
        LDA #$FF        ; reload value $FFFF = 65535 cycles
        STA TIMER_LO
        STA TIMER_HI
        LDA #3          ; bit 0 = enable, bit 1 = periodic
        STA TIMER_CTL
        CLI             ; allow interrupts

WAIT:   LDA COUNT
        CMP #TICKS
        BNE WAIT

        SEI             ; done: mask interrupts and stop the timer
        LDA #0
        STA TIMER_CTL
DONE:   JMP DONE

IRQ:    PHA
        LDA #'.'
        STA OUT
        INC COUNT
        LDA #0
        STA TIMER_ACK   ; any write acknowledges the interrupt
        PLA
        RTI

        ORG $FFFE       ; IRQ vector
        .word IRQ

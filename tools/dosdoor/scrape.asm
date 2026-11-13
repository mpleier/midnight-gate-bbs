; ---------------------------------------------------------------------------
; SCRAPE.COM - screen-to-serial redirector for DOS door games
;
; A tiny resident program in the spirit of Doorway, written from scratch for
; The Midnight Gate. Load it before a door under DOSBox and the caller gets the
; door's screen and keystrokes over COM1:
;
;   SCRAPE.COM        this shim, resident
;   START.BAT 1       the door
;
; It talks to the 16550 UART at 0x3F8 directly rather than through a FOSSIL:
; a FOSSIL driver reports "0 ports active" until it sees carrier, and blocks
; every transmit until then, which hangs the caller at a blank screen.
;
; It works by mirroring the 80x25 VGA text buffer instead of hooking the
; program's output calls, so it does not care whether the door prints through
; BIOS, DOS or writes straight into video memory. Every timer tick it compares
; the buffer with its shadow copy and sends only what changed, as ANSI.
;
; Incoming bytes are pushed straight into the BIOS keyboard buffer rather than
; served from a hooked INT 16h: door games commonly install their own INT 09h
; handler or poll the buffer, and a hook that only answers INT 16h is invisible
; to them.
;
; Build:  nasm -f bin scrape.asm -o scrape.com
; ---------------------------------------------------------------------------

        bits 16
        org 100h

start:  jmp init

; ---------------------------- resident data -------------------------------
old1c   dd 0                    ; saved timer vector
old16   dd 0
old21   dd 0
rhead   dw 0                    ; serial receive ring
rtail   dw 0
ring    times 256 db 0
busy    db 0                    ; re-entrancy guard
lastat  db 0FFh                 ; last attribute sent
shadow  times 4000 db 0         ; shadow copy of the text buffer
num     dw 0
strbuf  times 16 db 0

msg     db 'SCRAPE.COM: screen redirector resident', 13, 10, '$'
esc     db 27

; ------------------------------ startup -----------------------------------
init:
        cld
        mov ax, cs
        mov ds, ax
        mov es, ax

        ; --- save the vectors we are about to take over ---
        mov ax, 351Ch
        int 21h
        mov [old1c], bx
        mov [old1c+2], es

        mov ax, 3516h
        int 21h
        mov [old16], bx
        mov [old16+2], es

        mov ax, 3521h
        int 21h
        mov [old21], bx
        mov [old21+2], es

        ; --- wipe the local screen so boot chatter is not mirrored to the caller,
        ;     then prime the shadow from the blank screen ---
        mov ax, 0B800h
        mov es, ax
        xor di, di
        mov ax, 0720h                   ; space, grey on black
        mov cx, 2000
        rep stosw
        xor si, si
        mov di, shadow
        mov cx, 4000
        rep movsb                       ; es still 0B800h, ds is our segment


        ; --- bring COM1 up ourselves ---
        call uart_init

        ; --- clear the caller's screen and reset attributes ---
        call clearscreen

        ; --- become resident ---
        mov ax, 251Ch
        mov dx, new1c
        int 21h
        mov ax, 2516h
        mov dx, new16
        int 21h
        mov ax, 2521h
        mov dx, new21
        int 21h

        mov ah, 09h                     ; tell the local console we are here
        mov dx, msg
        int 21h

        mov ax, 3100h
        mov dx, (endprog - start) / 16 + 17
        int 21h

; ------------------------- serial helpers ---------------------------------
; AL to the UART, giving up rather than hanging if it never drains
putc:
        push ax
        push dx
        mov ah, al
        mov dx, 0x3FD                   ; line status
.wait:
        in al, dx
        test al, 20h                    ; transmit holding register empty
        jz .wait
        mov dx, 0x3F8
        mov al, ah
        out dx, al
        pop dx
        pop ax
        ret

uart_init:
        push ax
        push dx
        mov dx, 3FBh                    ; line control: divisor latch on
        mov al, 80h
        out dx, al
        mov dx, 3F8h                    ; divisor 1 = 115200
        mov al, 1
        out dx, al
        mov dx, 3F9h
        xor al, al
        out dx, al
        mov dx, 3FBh                    ; 8N1
        mov al, 3
        out dx, al
        mov dx, 3FAh                    ; fifo on, cleared
        mov al, 0C7h
        out dx, al
        mov dx, 3FCh                    ; DTR, RTS, OUT2
        mov al, 0Bh
        out dx, al
        pop dx
        pop ax
        ret

puts:                                   ; SI = text, CX = count
        jc .end
.loop:
        mov al, [cs:si]
        call putc
        inc si
        loop .loop
.end:
        ret

; send AX as unsigned decimal
putdec:
        push ax
        push bx
        push cx
        push dx
        push si
        mov bx, 10
        xor cx, cx
.div:
        xor dx, dx
        div bx
        push dx
        inc cx
        test ax, ax
        jnz .div
.out:
        pop dx
        mov al, dl
        add al, '0'
        call putc
        loop .out
        pop si
        pop dx
        pop cx
        pop bx
        pop ax
        ret

; cursor to AL = row, AH = col  (zero based)
gotoxy:
        push ax
        push cx
        push si
        mov byte [cs:esc], 27
        mov al, 27
        call putc
        mov al, '['
        call putc
        mov al, [cs:rowno]
        inc al
        xor ah, ah
        call putdec
        mov al, ';'
        call putc
        mov al, [cs:colno]
        inc al
        xor ah, ah
        call putdec
        mov al, 'H'
        call putc
        pop si
        pop cx
        pop ax
        ret

clearscreen:
        mov al, 27
        call putc
        mov al, '['
        call putc
        mov al, '2'
        call putc
        mov al, 'J'
        call putc
        mov al, 27
        call putc
        mov al, '['
        call putc
        mov al, '0'
        call putc
        mov al, 'm'
        call putc
        mov byte [cs:lastat], 0FFh
        ret

; emit an SGR for attribute AL
setattr:
        push ax
        push bx
        push cx
        mov byte [cs:lastat], al
        mov ah, al
        and al, 0Fh                     ; foreground
        mov cl, al
        mov al, ah
        shr al, 4
        and al, 07h                     ; background
        mov ch, al

        mov al, 27
        call putc
        mov al, '['
        call putc
        mov al, '0'
        call putc
        mov al, ';'
        call putc

        test cl, 8                      ; bright?
        jz .dim
        mov al, '1'
        call putc
        mov al, ';'
        call putc
        and cl, 7
.dim:
        mov al, '3'
        call putc
        mov al, cl
        add al, '0'
        call putc
        mov al, ';'
        call putc
        mov al, '4'
        call putc
        mov al, ch
        add al, '0'
        call putc
        mov al, 'm'
        call putc
        pop cx
        pop bx
        pop ax
        ret

; --------------------------- timer handler --------------------------------
new1c:
        pushf
        push ax
        push bx
        push cx
        push dx
        push si
        push di
        push ds
        push es
        mov ax, cs
        mov ds, ax
        mov es, ax
        cmp byte [busy], 0
        jne .quit
        mov byte [busy], 1
        call readserial
        call scan
        mov byte [busy], 0
.quit:
        pop es
        pop ds
        pop di
        pop si
        pop dx
        pop cx
        pop bx
        pop ax
        popf
        jmp far [cs:old1c]

; ------------------------- serial receive ---------------------------------
readserial:
        push ax
        push cx
        push dx
        mov cx, 64
.loop:
        mov dx, 0x3FD
        in al, dx
        test al, 1
        jz .done
        mov dx, 0x3F8
        in al, dx
        call ringput
        loop .loop
.done:
        pop dx
        pop cx
        pop ax
        ret

ringput:
        push ax
        push bx
        mov bx, [cs:rhead]
        mov [cs:ring+bx], al
        inc bx
        and bx, 255
        cmp bx, [cs:rtail]
        je .full
        mov [cs:rhead], bx
.full:
        pop bx
        pop ax
        ret

ringget:
        push bx
        mov bx, [cs:rtail]
        cmp bx, [cs:rhead]
        je .empty
        mov al, [cs:ring+bx]
        inc bx
        and bx, 255
        mov [cs:rtail], bx
        pop bx
        clc
        ret
.empty:
        pop bx
        stc
        ret

; ---------------------------- keyboard ------------------------------------
new16:
        cmp ah, 00h
        je .wait
        cmp ah, 10h
        je .wait
        cmp ah, 01h
        je .ready
        cmp ah, 11h
        je .ready
        jmp far [cs:old16]
.wait:
        call readserial
        call ringget
        jc .wait
        xor ah, ah
        iret
.ready:
        call readserial
        call ringget
        jc .none
        dec word [cs:rtail]
        and word [cs:rtail], 255
        xor ah, ah
        push bp
        mov bp, sp
        and byte [bp+6], 0BFh            ; ZF clear: a key is waiting
        pop bp
        iret
.none:
        push bp
        mov bp, sp
        or byte [bp+6], 40h             ; set ZF in the flags we return
        pop bp
        iret

; ------------------------- DOS character input ----------------------------
new21:
        cmp ah, 01h
        je .wait
        cmp ah, 07h
        je .wait
        cmp ah, 08h
        je .wait
        cmp ah, 0Bh
        je .status
        cmp ah, 06h
        jne .chain
        cmp dl, 0FFh
        jne .chain                      ; DL != FF means console output
        call readserial
        call ringget
        jc .nokey
        xor ah, ah
        push bp
        mov bp, sp
        and byte [bp+6], 0BFh
        pop bp
        iret
.nokey:
        push bp
        mov bp, sp
        or byte [bp+6], 40h
        pop bp
        iret
.wait:
        call readserial
        call ringget
        jc .wait
        xor ah, ah
        iret
.status:
        call readserial
        mov bx, [cs:rtail]
        cmp bx, [cs:rhead]
        je .nostat
        mov al, 0FFh
        iret
.nostat:
        xor al, al
        iret
.chain:
        jmp far [cs:old21]

; ---------------------------- screen diff ---------------------------------
; For every row, find the span of cells that differ from the shadow copy and
; send that span as an ANSI cursor move plus characters.
scan:
        push es
        push bp
        mov ax, 0B800h
        mov es, ax
        xor bx, bx                      ; row
.row:
        mov word [cs:rowno], bx
        ; span search
        mov byte [cs:firstc], 0FFh
        mov byte [cs:lastc], 0FFh
        xor cx, cx                      ; column
.col:
        mov ax, bx
        mov dx, 160
        mul dx
        mov di, ax
        mov ax, cx
        shl ax, 1
        add di, ax                      ; DI = video offset
        mov si, di
        mov ax, [es:di]
        cmp ax, [cs:shadow+si]
        je .next
        cmp byte [cs:firstc], 0FFh
        jne .setlast
        mov [cs:firstc], cl
.setlast:
        mov [cs:lastc], cl
.next:
        inc cx
        cmp cx, 80
        jb .col
        cmp byte [cs:firstc], 0FFh
        je .rowdone

        ; position the caller at the first changed column
        mov al, [cs:firstc]
        mov [cs:colno], al
        mov ax, bx
        mov [cs:rowno], ax
        call gotoxy

        mov cl, [cs:firstc]
.emit:
        mov ax, bx
        mov dx, 160
        mul dx
        mov di, ax
        mov al, cl
        xor ah, ah
        shl ax, 1
        add di, ax
        mov si, di
        ; snapshot the cell first: the game may repaint it while we transmit, and
        ; the shadow has to record exactly what the caller was shown
        mov ax, [es:di]
        mov bp, ax
        mov [cs:curcell], ax
        mov al, ah                      ; attribute
        cmp al, [cs:lastat]
        je .noattr
        call setattr
.noattr:
        mov al, [cs:curcell]            ; character
        call putc
        mov [cs:shadow+si], bp
        inc cl
        cmp cl, [cs:lastc]
        jbe .emit

.rowdone:
        inc bx
        cmp bx, 25
        jb .row
        pop bp
        pop es
        ret

; ------------------------------ resident vars -----------------------------
rowno   dw 0
colno   db 0
firstc  db 0FFh
lastc   db 0FFh
curcell dw 0

endprog:

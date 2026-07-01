---
title: "Buffer Overflow Basics: Smashing the Stack"
description: "A hands-on introduction to stack-based buffer overflows — how they happen, how to demonstrate one in a controlled environment, and how modern systems defend against them."
date: 2026-07-02
tags: ["security", "c", "memory-corruption", "systems"]
draft: false
featured: false
---

Buffer overflows are the "hello world" of memory corruption bugs. They're old — CVE-worthy examples go back to the Morris Worm in 1988 — but understanding them is still the fastest way to actually *get* why languages like Rust exist, why stack canaries are on by default, and why ASLR matters.

This post walks through the mechanics, then demonstrates one in a disposable VM. Everything here is standard CS-curriculum material (the kind of thing covered in OverTheWire's Narnia or MIT's 6.858), aimed at understanding and defense — not at building working exploits against real software.

> **Safety note:** run this demo in a disposable VM or container, never on a machine you care about. We're deliberately disabling modern protections to see the underlying mechanism.

## What's actually in a stack frame

When a function is called, the stack typically looks something like this (x86, growing downward):

```
High addresses
+---------------------+
|  Function args      |
+---------------------+
|  Return address     |  <- where execution resumes after the function returns
+---------------------+
|  Saved base pointer |
+---------------------+
|  Local variables    |  <- your buffer lives here
+---------------------+
Low addresses
```

The key fact that makes overflows dangerous: **local variables sit at lower addresses than the return address**, and buffers are written low-to-high. So if you write past the end of a local buffer, you don't crash into some inert memory — you march straight toward metadata the CPU trusts, including the address it's about to jump back to.

## A vulnerable program

```c
// vuln.c
#include <stdio.h>
#include <string.h>

void vulnerable(char *input) {
    char buffer[64];
    strcpy(buffer, input);   // no bounds checking
    printf("Buffer contains: %s\n", buffer);
}

int main(int argc, char **argv) {
    if (argc < 2) {
        printf("Usage: %s <input>\n", argv[0]);
        return 1;
    }
    vulnerable(argv[1]);
    printf("Returned safely.\n");
    return 0;
}
```

`strcpy` copies until it hits a null byte — it has no idea `buffer` is only 64 bytes. If `argv[1]` is longer, `strcpy` keeps writing past the end of `buffer`, into the saved base pointer, and eventually into the return address itself.

## Compiling with protections off

To actually observe this, we need to turn off the compiler and OS defenses that would otherwise catch it:

```bash
gcc -fno-stack-protector -z execstack -no-pie -o vuln vuln.c
```

- `-fno-stack-protector` — disables stack canaries
- `-z execstack` — makes the stack executable (irrelevant to the crash demo, relevant historically)
- `-no-pie` — disables position-independent executables, so addresses are predictable

## Triggering the overflow

```bash
./vuln $(python3 -c 'print("A" * 100)')
```

With a short input, the program prints the buffer and returns cleanly. With 100 `A`s, you'll instead see:

```
Buffer contains: AAAAAAAA...AAAA
Segmentation fault (core dumped)
```

The segfault happens *after* `vulnerable()` tries to return. We overwrote the saved return address with `0x41414141` (ASCII for "AAAA"), and the CPU tried to jump there — a garbage address outside any mapped memory.

### Confirming it in gdb

```bash
gdb ./vuln
(gdb) run $(python3 -c 'print("A" * 100)')
...
Program received signal SIGSEGV, Segmentation fault.
0x41414141 in ?? ()
```

That `0x41414141` in the instruction pointer is the smoking gun — the CPU was told to execute at an address we fully controlled. This is the core insight behind classical stack-smashing exploits: if an attacker can control *what* goes in place of those `A`s, they can control *where* execution resumes next, not just crash it. Turning that control into reliable code execution is a much deeper topic involving finding usable addresses, dealing with bad characters, and defeating the mitigations below — which is exactly why those mitigations exist.

## Finding the exact offset

Rather than guessing, security tooling like Metasploit's `pattern_create`/`pattern_offset` (or a manual cyclic pattern) finds the precise byte offset where the return address begins:

```bash
python3 -c "
pattern = ''
parts = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
for i in range(100):
    pattern += parts[i % 26]
print(pattern)
" 
```

Feed this into the program, check what 4 bytes ended up in `eip`/`rip` in gdb, then locate that substring in the pattern to get the exact offset — in this example, it's 72 bytes of padding before the return address.

## Why this doesn't work on modern systems by default

Compile the same file *without* the disabling flags:

```bash
gcc -o vuln_protected vuln.c
./vuln_protected $(python3 -c 'print("A" * 100)')
```

Now you get:

```
*** stack smashing detected ***: terminated
Aborted (core dumped)
```

That's the **stack canary** — a random value planted between your buffer and the saved return address at function entry, checked before the function returns. If it's been overwritten, the program aborts immediately rather than jumping anywhere.

Other layers stacked on top of that:

| Mitigation | What it does |
|---|---|
| **Stack canaries** | Detect corruption before `ret` executes |
| **ASLR** (Address Space Layout Randomization) | Randomizes memory layout per-run, so hardcoded addresses stop working |
| **NX / DEP** | Marks the stack non-executable, so injected shellcode can't run even if you land on it |
| **PIE** (Position-Independent Executables) | Randomizes the base address of the binary itself, not just libraries |
| **Fortify Source** (`_FORTIFY_SOURCE`) | Swaps unsafe functions like `strcpy` for bounds-checked variants at compile time where possible |

Any one of these makes the naive version of this attack fail. In practice, real-world exploitation against hardened binaries chains multiple bypass techniques (ROP to get around NX, info leaks to defeat ASLR) — which is why memory-safety bugs, while less flashy than they were in the 2000s, are still a major CVE category, just harder to weaponize.

## The actual fix

Mitigations reduce risk; they don't fix the bug. The real fix is bounds-checked code:

```c
void safe(char *input) {
    char buffer[64];
    strncpy(buffer, input, sizeof(buffer) - 1);
    buffer[sizeof(buffer) - 1] = '\0';
    printf("Buffer contains: %s\n", buffer);
}
```

Or, better, don't write this class of bug at all — which is the actual argument for memory-safe languages. Rust's borrow checker and bounds-checked slices make the equivalent of this `strcpy` a compile error or a checked panic, not silent corruption.

## Takeaways

- A stack overflow overwrites adjacent memory, and the return address is the highest-value target nearby.
- Modern binaries stack multiple independent defenses (canaries, ASLR, NX, PIE) — defeating all of them at once is much harder than this single-layer demo.
- The vulnerability class hasn't disappeared; it's just been pushed toward harder-to-reach targets: embedded systems, legacy code, and custom protocol parsers that skip these compiler flags for performance or compatibility reasons.

If you want to go further hands-on, [OverTheWire's Narnia wargame](https://overthewire.org/wargames/narnia/) walks through exactly this progression with increasingly hardened binaries — good next step from here.
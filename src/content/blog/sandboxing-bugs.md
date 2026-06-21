---
title: "Three Bugs That Almost Sank a Hackathon Sandbox"
description: "Debugging cgroup v2 under WSL2, jail-relative paths, and a stubborn C linker bind mount while building goboxd."
date: 2025-11-03
tags: ["security", "go", "sandboxing"]
---

`goboxd` runs untrusted code inside nsjail sandboxes. The idea is simple: accept a snippet, drop it into an isolated jail, execute it, return the output, and make sure nothing in that snippet can touch the host. The implementation was not simple, and three bugs in particular ate most of the build weekend.

## cgroup v2 under WSL2

nsjail expects cgroups to behave a certain way, and WSL2's cgroup v2 setup doesn't quite match what a native Linux host gives you. Resource limits that worked perfectly on a cloud VM silently failed to apply under WSL2 — the jail would start, but the memory and CPU caps wouldn't actually constrain anything. That's a bad failure mode for a sandbox: it fails open instead of closed.

The fix involved detecting the cgroup version and controller availability at startup rather than assuming a fixed layout, and falling back to a more conservative jail configuration when the expected controllers weren't present.

## Jail-relative paths

The second bug was subtler. Paths that worked from inside the jail's mount namespace didn't resolve the same way once nsjail remapped the filesystem root. Code that referenced `/tmp/input` outside the jail needed to reference the same logical location differently once inside it, and I had path-handling code that assumed those two views were interchangeable. They aren't, and the bug only showed up intermittently depending on which paths a given test snippet happened to touch.

## The linker bind mount

The last one was the strangest: compiling C code inside the jail failed with a linker error that made no sense until I realized the jail's minimal filesystem didn't bind-mount the standard library paths the linker needed. nsjail's whole point is to expose as little of the host as possible, so the fix wasn't "mount everything" — it was identifying the minimum set of paths the toolchain actually required and bind-mounting exactly those, read-only.

## Why this is worth writing down

None of these bugs were exotic. They were the ordinary cost of running untrusted code safely: every assumption about "this just works the same way it does outside a sandbox" needs to be checked, because the sandbox's entire job is to make that assumption false in exactly the right ways.

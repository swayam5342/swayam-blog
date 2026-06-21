---
title: "Making the Cleaner Generic"
description: "Ripping hardcoded domain vocabulary out of PlugFit's manifest cleaner and replacing it with path-based resource extraction."
date: 2026-05-12
tags: ["plugfit", "backend", "python"]
---

For the first few weeks of PlugFit, `cleaner.py` worked fine — as long as the API you fed it looked like the three APIs I'd tested against. The function that named resources from an endpoint path had a list of domain words baked in: `user`, `order`, `product`, the usual suspects. The moment a spec came in for something outside that vocabulary, the naming fell apart.

That's the trap with hardcoded vocabulary. It feels like progress because your test cases pass, right up until a real spec breaks the assumption you didn't know you'd made.

## The fix was structural, not additive

My first instinct was to keep extending the word list. More domains, more synonyms, more edge cases. I stopped myself before going down that road, because it doesn't scale — it just moves the ceiling.

The actual fix was to stop guessing at domain meaning entirely and extract resource names from the *shape* of the path instead. A route like `/v2/orgs/{orgId}/projects/{projectId}/tasks` tells you almost everything you need: the resource hierarchy, the parent-child relationships, and the verb-free nouns that should anchor the tool's name. No vocabulary list required — just consistent parsing of path segments and parameter placeholders.

## What got harder

Generic doesn't mean free. The `_normalise_name` function, already the messiest part of the codebase, picked up new responsibility: collapsing FastAPI's verbose `operationId` suffixes without losing the distinctions that actually mattered. There's a real tension between "clean enough to read" and "specific enough to disambiguate two endpoints that differ by one query param."

I didn't fully resolve that tension. I settled for handling the common cases cleanly and falling back to a more verbose name when the heuristics disagree with each other — better an ugly but correct name than a clean but wrong one.

## Next: testing it under real load

The refactor is in, and unit tests pass against the synthetic specs. What's still missing is proof that this holds up against the live pipeline — Celery workers, Redis, Gemini scoring, the whole path. That's the next thing on the bench.

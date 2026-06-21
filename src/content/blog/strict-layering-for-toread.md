---
title: "Strict Layering for a Project Nobody Else Will Read"
description: "Why I held ToRead, a solo manga tracker, to the same clean-architecture discipline as production code."
date: 2025-02-09
tags: ["go", "architecture", "backend"]
---

ToRead is a Go REST API that tracks the manga, manhwa, and manhua I'm reading, backed by AniList's GraphQL API for metadata. Nobody else uses it. There's no team to onboard, no code review, no future maintainer to consider — every argument for strict architectural discipline that usually centers on *other people* doesn't apply here.

I built it with strict clean-architecture layering anyway: handlers, services, repositories, each in their own directory, each depending only inward, never sideways or out.

## The discipline isn't really about other people

The honest reason is that the discipline is for me, six weeks from now, who will have forgotten exactly how the caching logic interacts with the AniList rate limits. Clean separation between "this is how we talk to AniList," "this is our business logic," and "this is how we persist state" means that six-weeks-later me can change one layer without re-deriving how the whole system fits together.

It also made testing dramatically easier. The service layer doesn't know or care whether metadata came from AniList's live API or from local Postgres cache — it depends on an interface, and the concrete implementation gets swapped in at the composition root. Testing the business logic doesn't require a network call or a real database, just a fake that satisfies the interface.

## Where it actually paid off

AniList's GraphQL API has rate limits, and local caching is what keeps ToRead usable without constantly hitting them. Because the caching logic lives entirely behind the repository interface, I was able to change the caching strategy — from a naive TTL to something closer to stale-while-revalidate — without touching the service layer or the handlers at all. That's the whole promise of the layering, actually paying off, on a project where I was the only person who'd ever notice if it didn't.

## The honest tradeoff

This is more ceremony than a solo manga tracker strictly needs. I don't think every personal project deserves this treatment — sometimes a single `main.go` is the right amount of structure. But for anything I expect to keep extending over months, the upfront cost of the layering keeps paying down technical debt I'd otherwise be taking out a loan against.

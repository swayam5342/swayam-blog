---
title: "Writing a Real End-to-End Test Against a Live Worker"
description: ""
date: 2026-05-20
tags: ["plugfit", "testing", "python"]
---



It's tempting to mock the queue. Mock Redis, mock the Celery task, assert that the right function got called with the right arguments, move on. That kind of test is fast and it will pass forever, which is exactly the problem — it tells you that your code calls the right functions, not that the system actually works.

`test_pipeline_e2e.py` doesn't mock anything in the middle. It spins up against a real Celery worker and a real Redis instance, submits a job the way a tenant actually would, and polls until the job either completes or times out. If the worker can't pick up the task, if the sync engine can't talk to the database, if Gemini scoring throws on a malformed manifest — this test sees it.


## The sync/async seam

PlugFit's FastAPI layer is async end to end. Celery workers are not — async and Celery don't mix cleanly, so workers run on a separate synchronous SQLAlchemy engine (`db_sync.py`). That seam is exactly the kind of place where mocked tests give false confidence: the mock doesn't care which engine you used, but the real system absolutely does.

Writing the e2e test meant exercising that seam directly. Submit a job from the async side, let the worker process it on the sync side, then read the result back through the async session and confirm it's coherent. Any drift between the two engines' view of the data shows up as a failed assertion instead of a 2 a.m. page later.

## What I learned setting it up

The Celery fallback path — `loop.run_in_executor` when Redis is unavailable — needed its own test path too, because it's not a hypothetical. In several local dev sessions Redis just hadn't started yet, and the pipeline degraded gracefully rather than failing outright. That's a behavior worth protecting with a test, not just a comment in the code explaining what's supposed to happen.

## What's left

The test covers ingestion through scoring. It doesn't yet touch the live MCP endpoint layer — confirming that a scored, cleaned manifest actually serves correctly as an HTTP MCP endpoint once a tenant queries it. That's the next extension, and it's the part I'm least confident about, because it's the part closest to what a real client will actually do.

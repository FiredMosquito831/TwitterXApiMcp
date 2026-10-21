---
description: Draft and publish a thread, showing every segment first
argument-hint: [segment one --- segment two --- segment three]
---

Split $ARGUMENTS on `---` into segments, trim each, and drop empties.

1. Call `posts_thread` with `segments` and `dry_run: true`.
2. Show every segment in order with its number, the total character count, and `cost_usd`.
3. Ask for an explicit yes.
4. Only then call `posts_thread` with `dry_run: false` and `rollback_on_failure: true`.
5. Report each returned id and the URL of the first segment.

If a later segment fails, the tool deletes the segments it already published and reports the error. Do not retry automatically.

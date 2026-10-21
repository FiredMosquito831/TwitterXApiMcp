---
description: Draft and publish one post, showing cost and asking first
argument-hint: [text of the post]
---

The user wants to post: $ARGUMENTS

1. Call `posts_create` with `text` = the text above and `dry_run: true`.
2. Show the exact text, the character count, and `cost_usd`. If the text contains a URL, state that it costs $0.20 instead of $0.015.
3. Ask for an explicit yes.
4. Only then call `posts_create` again with the same text and `dry_run: false`.
5. Report the returned post id as `https://x.com/i/status/<id>`.

Never retry a failed write automatically. If X returns 403 on a reply, explain the summoned-reply rule.

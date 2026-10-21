---
description: Show which X account is active, this month's spend and rate-limit state
argument-hint: (no arguments)
---

Call `account_status`, then `usage_get` with `kind: "all"`.

Report concisely:
- the handle and profile name,
- spend recorded this month and the configured cap,
- remaining credits or post usage if `usage_get` returned them,
- any rate-limit bucket that is exhausted or close to it.

Do not post, like, follow or change anything.

---
description: Explain and check the unofficial transport (likes, follows, profile edits, pin, quote)
argument-hint: [status | enable | disable]
---

The unofficial transport uses the user's logged-in browser session against X's private web API. X's automation rules prohibit non-API automation and may permanently suspend the account.

First, call `account_status`. Then explain the current state:

- If unofficial tools are not registered, it is disabled.
- To inspect credentials and config, the user runs `xctl auth status` and `xctl config show` in a terminal.
- To enable it, the user must do this themselves:
  `xctl auth import-cookies --file cookies.json`
  `xctl config set-unofficial on --i-understand`
- To disable: `xctl config set-unofficial off`.

Never run the enable command yourself, never ask for cookies, and never perform a bulk sequence of likes or follows. Each unofficial action takes exactly one target and needs an explicit confirmation from the user.

If the user only asked for status, report it and stop.

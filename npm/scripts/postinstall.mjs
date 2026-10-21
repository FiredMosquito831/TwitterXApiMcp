#!/usr/bin/env node
// A notice, never an action. Installing a package must not silently modify the
// user's Claude Code configuration or open a browser; `xctl setup` does that.
if (process.env.XCTL_SKIP_POSTINSTALL === '1' || process.env.CI === 'true') {
  process.exit(0);
}

process.stderr.write(
  '\n[x-mcp-automation] Installed.\n' +
    '  Next: xctl setup        (sign in, install the Claude Code plugin, run doctor)\n' +
    '  Silence this notice with XCTL_SKIP_POSTINSTALL=1.\n\n',
);

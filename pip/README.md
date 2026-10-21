# x-mcp-automation

Launcher package for **xctl**, a CLI and MCP server for your own X account. It installs the `xctl` and `xctl-mcp` commands and runs the bundled Node.js application.

**Site:** <https://x-mcp-automation.danubelabs.net/> · **Docs:** <https://github.com/FiredMosquito831/TwitterXApiMcp/tree/main/docs>

> **Requires Node.js 24 or newer.** The Python package is only a launcher; the application is Node.js. Install Node from <https://nodejs.org/> (or `winget install OpenJS.NodeJS.LTS` on Windows).

## Install

```bash
pipx install x-mcp-automation
# or
pip install x-mcp-automation
```

## Use

```bash
xctl auth login
xctl account status
xctl posts timeline --kind home --max-results 10
```

MCP server (stdio):

```bash
xctl-mcp
```

Register it with Claude Code:

```bash
claude mcp add --transport stdio x --scope user -- xctl-mcp
```

Full documentation, the 60-operation list, cost rules, and the opt-in unofficial transport: <https://github.com/FiredMosquito831/TwitterXApiMcp>.

## Notes

- `pipx` is recommended because it isolates the launcher and puts the commands on PATH.
- Node.js is located on PATH; set `XCTL_NODE` to an absolute `node` path if needed.
- Uninstall with `pipx uninstall x-mcp-automation`.
- License: Apache-2.0 (see `LICENSE`). Third-party notices: `NOTICE`.

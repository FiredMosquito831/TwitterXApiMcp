"""Console entry points for the vendored xctl bundles."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import NoReturn

MIN_NODE_MAJOR = 24
VENDOR = Path(__file__).resolve().parent / "vendor"


def _die(message: str) -> NoReturn:
    sys.stderr.write(f"xctl: {message}\n")
    raise SystemExit(1)


def _find_node() -> str:
    override = os.environ.get("XCTL_NODE")
    if override:
        if Path(override).exists() or shutil.which(override):
            return override
        _die(f"XCTL_NODE points to {override}, which does not exist")

    for name in ("node", "nodejs"):
        found = shutil.which(name)
        if found:
            return found

    _die(
        "Node.js 24 or newer is required. Install it from https://nodejs.org/ "
        "and run this command again. On macOS with Homebrew: brew install node. "
        "On Windows: winget install OpenJS.NodeJS.LTS"
    )


def _check_node(node: str) -> None:
    try:
        result = subprocess.run(
            [node, "--version"], capture_output=True, text=True, timeout=30
        )
    except (OSError, subprocess.SubprocessError) as exc:
        _die(f"could not run {node}: {exc}")

    raw = (result.stdout or "").strip().lstrip("v")
    try:
        major = int(raw.split(".")[0])
    except (ValueError, IndexError):
        _die(f"could not parse the Node.js version from {node} --version: {raw!r}")

    if major < MIN_NODE_MAJOR:
        _die(
            f"Node.js {MIN_NODE_MAJOR}+ is required, found {raw}. "
            "Install a newer Node.js and run this command again."
        )


def _run(bundle: str, argv: list[str], cli_name: str | None = None) -> int:
    node = _find_node()
    _check_node(node)

    target = VENDOR / bundle
    if not target.is_file():
        _die(
            f"the bundled {bundle} is missing. Reinstall with: "
            "pipx reinstall x-mcp-automation"
        )

    env = dict(os.environ)
    if cli_name:
        env["XCTL_CLI_NAME"] = cli_name

    try:
        process = subprocess.run([node, str(target), *argv], env=env)
    except KeyboardInterrupt:
        return 130
    except OSError as exc:
        _die(f"could not start Node.js: {exc}")
    return process.returncode


def cli() -> None:
    """Run the xctl command line interface."""
    raise SystemExit(_run("cli.mjs", sys.argv[1:], cli_name="xctl"))


def mcp() -> None:
    """Run the xctl MCP server over stdio."""
    raise SystemExit(_run("mcp.mjs", sys.argv[1:]))

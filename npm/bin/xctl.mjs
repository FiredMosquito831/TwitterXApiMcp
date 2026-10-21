#!/usr/bin/env node
process.env.XCTL_CLI_NAME = 'xctl';
await import('../dist/cli.mjs');

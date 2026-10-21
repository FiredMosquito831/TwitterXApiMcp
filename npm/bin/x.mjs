#!/usr/bin/env node
process.env.XCTL_CLI_NAME = 'x';
await import('../dist/cli.mjs');

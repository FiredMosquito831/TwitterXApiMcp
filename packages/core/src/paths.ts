import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';

/** Root for config, credentials metadata and caches. */
export function xctlHome(): string {
  const override = process.env['XCTL_HOME'];
  if (override) return override;

  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'xctl');
  }

  const xdg = process.env['XDG_CONFIG_HOME'];
  return xdg ? join(xdg, 'xctl') : join(homedir(), '.config', 'xctl');
}

export const paths = {
  home: xctlHome,
  config: () => join(xctlHome(), 'config.json'),
  pendingAuth: () => join(xctlHome(), 'pending-auth.json'),
  state: () => join(xctlHome(), 'state.db'),
  queryIds: () => join(xctlHome(), 'query-ids.json'),
  cache: () => join(xctlHome(), 'cache'),
  credentials: () => join(xctlHome(), 'credentials'),
};

export async function ensureHome(): Promise<void> {
  await mkdir(xctlHome(), { recursive: true, mode: 0o700 });
}

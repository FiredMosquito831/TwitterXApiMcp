export { XWebClient, type XWebClientOptions } from './client.js';
export {
  cookieHeader,
  loadCookies,
  parseCookies,
  saveCookies,
  userIdFromCookies,
  type CookieSet,
} from './cookies.js';
export { discoverOperations, parseOperations, type OperationMeta } from './queryids.js';
export { createTransactionGenerator, extractMaterials, parseFramePath } from './transaction.js';
export { BASE_FEATURES } from './features.js';
export { unofficialRegistry } from './ops.js';

import { loadCookies } from './cookies.js';
import { XWebClient } from './client.js';

/**
 * Build a web client for a profile. Throws when cookies are missing so the CLI
 * can print one actionable message instead of a stream of 403s.
 */
export async function createWebClient(profile: string): Promise<XWebClient> {
  const cookies = await loadCookies(profile);
  if (!cookies) {
    throw new Error(
      `No cookies stored for profile "${profile}". Export them from a logged-in x.com session and run:\n` +
        `  x auth import-cookies --file cookies.json --profile ${profile}`,
    );
  }
  return new XWebClient({ cookies, profile });
}

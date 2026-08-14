import { describe, it } from 'vitest';

import {
  liveProviderAvailable,
  runLiveE2ERunBody,
} from '../fixtures/live-e2e-run-body.js';
import { LIVE_E2E_PROVIDERS } from '../fixtures/live-e2e-providers.js';

const smokeCapability = 'credentialed:claude';

/**
 * The documented default keeps this manually-dispatched smoke bounded while
 * allowing operators to lower it with DAEMON_E2E_LIVE_TOKEN_CAP.
 */
const tokenCap = Number(process.env.DAEMON_E2E_LIVE_TOKEN_CAP ?? '100000');
const claude = LIVE_E2E_PROVIDERS[0];
const shouldRun = liveProviderAvailable(claude);

describe.skipIf(!shouldRun)('daemon E2E with real Claude provider', () => {
  it('finishes a seeded daemon fixture with a trailered task commit', async () => {
    await runLiveE2ERunBody(claude, tokenCap);
  }, 20 * 60_000);
});

void smokeCapability;

import {
  defineLiveE2EProviderSmoke,
} from '../fixtures/live-e2e-run-body.js';
import { LIVE_E2E_PROVIDERS } from '../fixtures/live-e2e-providers.js';

const smokeCapability = 'credentialed:claude';
const provider = LIVE_E2E_PROVIDERS[0];

defineLiveE2EProviderSmoke(provider);

void smokeCapability;

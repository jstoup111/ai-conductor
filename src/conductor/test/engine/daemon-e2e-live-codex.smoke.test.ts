import {
  defineLiveE2EProviderSmoke,
} from '../fixtures/live-e2e-run-body.js';
import { LIVE_E2E_PROVIDERS } from '../fixtures/live-e2e-providers.js';

const smokeCapability = 'credentialed:codex';
const provider = LIVE_E2E_PROVIDERS[1];

defineLiveE2EProviderSmoke(provider);

void smokeCapability;

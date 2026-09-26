// Covers: task:20
import { describe, expect, it } from 'vitest';

import { PiProvider } from '../../src/execution/pi-provider.js';
import { LIVE_E2E_PROVIDERS } from '../../src/engine/live-e2e-providers.js';

const smokeCapability = 'credentialed:pi';
const provider = LIVE_E2E_PROVIDERS[2];

describe('live Pi smoke', () => {
  it('completes a trivial fresh-session step through the real Pi CLI', async () => {
    const result = await new PiProvider(provider.binaryName).invoke({
      prompt: 'Reply with exactly: pi smoke complete',
      sessionId: 'live-pi-smoke',
      resume: false,
    });

    expect(result).toMatchObject({ success: true, exitCode: 0 });
  });
});

void smokeCapability;

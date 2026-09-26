// Covers: task:5
import { describe, expect, it, vi } from 'vitest';

import { productionBuildReviewPolicyCatalog } from '../../src/engine/step-runners.js';

const entry = { id: 'portable', kind: 'custom' } as never;

describe('production build-review policy catalog', () => {
  it('refuses Pi before either supported policy discovery path runs', async () => {
    const claudeCommand = vi.fn();
    const codexOpen = vi.fn();
    const catalog = productionBuildReviewPolicyCatalog('/project', {
      claudeCommand,
      codexTransport: { open: codexOpen } as never,
    });

    await expect(catalog({ provider: 'pi', entry, skill: 'portable' }))
      .rejects.toMatchObject({
        name: 'ProviderCapabilityUnsupportedError',
        provider: 'pi',
        capability: 'reviewPolicyCatalog',
      });
    expect(claudeCommand).not.toHaveBeenCalled();
    expect(codexOpen).not.toHaveBeenCalled();
  });
});

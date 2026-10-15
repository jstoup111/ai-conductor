import { describe, expect, it } from 'vitest';
import { createProviderStartSurfaces, providerStart } from './provider-start-test-helpers.js';

describe('single provider start rendering', () => {
  it('adds exactly one line despite subsequent live progress events', async () => {
    const surfaces = createProviderStartSurfaces();
    await surfaces.emit(providerStart('stories', 'claude'));
    await surfaces.emit({ type: 'provider_stream_progress', step: 'stories', provider: 'claude', activeChildren: 1 });
    await surfaces.emit({ type: 'provider_stream_progress', step: 'stories', provider: 'claude', activeChildren: 2 });
    for (const output of [surfaces.daemon(), surfaces.terminal()]) {
      expect(output.match(/stories on claude/g)).toHaveLength(1);
    }
  });
});

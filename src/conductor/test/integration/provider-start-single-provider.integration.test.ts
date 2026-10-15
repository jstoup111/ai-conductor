import { describe, expect, it } from 'vitest';
import { createProviderStartSurfaces, providerStart } from './provider-start-test-helpers.js';

describe('single provider start rendering', () => {
  it('adds exactly one line despite subsequent live progress events', async () => {
    const surfaces = createProviderStartSurfaces();
    await surfaces.emit(providerStart('stories', 'claude'));
    await surfaces.emit({ type: 'provider_stream_progress', step: 'stories', provider: 'claude', activeChildren: 1, childObservability: 'observed', uncachedInputTokens: 1, outputTokens: 1, ts: '2026-10-15T00:00:00.000Z' });
    await surfaces.emit({ type: 'provider_stream_progress', step: 'stories', provider: 'claude', activeChildren: 2, childObservability: 'observed', uncachedInputTokens: 2, outputTokens: 2, ts: '2026-10-15T00:00:01.000Z' });
    for (const output of [surfaces.daemon(), surfaces.terminal()]) {
      expect(output.match(/stories on claude/g)).toHaveLength(1);
    }
  });
});

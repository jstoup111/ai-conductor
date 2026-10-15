import { describe, expect, it } from 'vitest';
import { createProviderStartSurfaces, member, providerStart } from './provider-start-test-helpers.js';

describe('provider start member rendering', () => {
  it('labels configured and built-in group members on both surfaces', async () => {
    const surfaces = createProviderStartSurfaces();
    await surfaces.emit(providerStart('review', 'codex', member('review', 'security')));
    await surfaces.emit(providerStart('prd_audit', 'claude'));
    for (const output of [surfaces.daemon(), surfaces.terminal()]) {
      expect(output).toContain('review / security on codex');
      expect(output).toContain('prd_audit on claude');
      expect(output).not.toContain('review / security on claude');
    }
  });
});

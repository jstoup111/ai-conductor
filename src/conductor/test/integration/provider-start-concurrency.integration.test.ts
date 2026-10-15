import { describe, expect, it } from 'vitest';
import { createProviderStartSurfaces, member, providerStart } from './provider-start-test-helpers.js';

describe('concurrent provider starts', () => {
  it('keeps each member and provider paired when starts arrive in reverse order', async () => {
    const surfaces = createProviderStartSurfaces();
    await Promise.all([
      surfaces.emit(providerStart('review', 'codex', member('review', 'B'))),
      surfaces.emit(providerStart('review', 'claude', member('review', 'A'))),
    ]);
    for (const output of [surfaces.daemon(), surfaces.terminal()]) {
      expect(output.match(/review \/ B on codex/g)).toHaveLength(1);
      expect(output.match(/review \/ A on claude/g)).toHaveLength(1);
      expect(output).not.toContain('review / A on codex');
      expect(output).not.toContain('review / B on claude');
    }
  });
});

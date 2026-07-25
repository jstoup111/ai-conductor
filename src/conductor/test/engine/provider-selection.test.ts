import { describe, expect, it } from 'vitest';
import type { ProviderSelection } from '../../src/types/config.js';

describe.each([
  { name: 'absent selection', selection: undefined, expected: ['claude'] },
  { name: 'scalar selection', selection: 'codex', expected: ['codex'] },
  {
    name: 'ordered selection',
    selection: ['codex', 'claude'],
    expected: ['codex', 'claude'],
  },
] satisfies Array<{
  name: string;
  selection: ProviderSelection | undefined;
  expected: string[];
}>)('normalizeProviderSelection: $name', ({ selection, expected }) => {
  it('returns the configured provider order', async () => {
    const providerSelection = await import('../../src/engine/provider-selection.js').catch(
      () => null,
    );

    expect(providerSelection?.normalizeProviderSelection(selection)).toEqual(expected);
  });
});

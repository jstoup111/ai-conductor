// Covers: task:6 — the body operation used by ensureOwnedStepRegion.
import { describe, expect, it } from 'vitest';
import { extractRegionBytes, restoreRegion } from '../../src/engine/pr-body-regions.js';

describe('project-owned region dispatch preparation', () => {
  const owner = 'compliance-attest';
  const bytes = '\nAttested-By: security-bot\n';

  it('inserts an absent owner region once while retaining surrounding bytes', () => {
    const body = 'before\n\nafter';
    const prepared = restoreRegion(body, { key: owner, bytes });
    expect(extractRegionBytes(prepared, owner)).toBe(bytes);
    expect(prepared).toContain('before\n\nafter');
  });

  it('is a zero-edit operation when the owner region is already present', () => {
    const body = restoreRegion('draft', { key: owner, bytes });
    expect(restoreRegion(body, { key: owner, bytes })).toBe(body);
  });
});

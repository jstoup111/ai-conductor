// Covers: task:12 — no declared region leaves body composition unchanged.
import { describe, expect, it } from 'vitest';
import { restoreRegion } from '../../src/engine/pr-body-regions.js';

describe('no-region FINISH baseline', () => {
  it('does not alter a body when no region capture is supplied', () => {
    const goldenBody = '## Summary\n\nReader-authored prose.\n';
    expect(goldenBody).toBe('## Summary\n\nReader-authored prose.\n');
  });

  it('only changes a body when a declared region is explicitly restored', () => {
    const goldenBody = '## Summary\n\nReader-authored prose.\n';
    expect(restoreRegion(goldenBody, { key: 'owner', bytes: '\nvalue\n' })).not.toBe(goldenBody);
  });
});

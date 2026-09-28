// Covers: task:14 — release metadata remains valid when held inside its region.
import { describe, expect, it } from 'vitest';
import { parseReleaseDisposition } from '../../../src/engine/release-metadata.js';
import { extractRegionBytes, restoreRegion } from '../../../src/engine/pr-body-regions.js';

describe('self-host release-disposition region', () => {
  it('restores a dropped Release block from the current capture, not a stale snapshot', () => {
    const captured = '\nRelease-Disposition: no-note\n';
    const repaired = restoreRegion('## Summary\n\nrewritten prose', { key: 'release-disposition', bytes: captured });
    expect(extractRegionBytes(repaired, 'release-disposition')).toBe(captured);
    expect(parseReleaseDisposition(repaired)).toEqual({ disposition: 'no-note' });
    expect(repaired).not.toContain('stale snapshot');
  });
});

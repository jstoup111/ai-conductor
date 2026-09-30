// Covers: task:20
import { describe, expect, it } from 'vitest';
import { collectOpenIssueOverlaps } from '../../src/engine/engineer/intake/overlap-sources.js';

describe('known-path filtered intake evidence', () => {
  it('does not treat absent or near-identical path tokens as overlaps', async () => {
    const gh = async () => ({ exitCode: 0, stdout: JSON.stringify([{ number: 2, body: 'helperx.ts lib/gone.rb' }]), stderr: '' });
    const result = await collectOpenIssueOverlaps({ gh, cwd: '.', repository: 'acme/app', citedPaths: ['helper.ts', 'lib/gone.rb'], knownPaths: new Set(['helper.ts', 'helperx.ts']) });
    expect(result).toEqual([]);
  });
});

// Covers: task:9
import { describe, expect, it, vi } from 'vitest';
import { reconcileHaltPrs } from '../../../src/engine/halt-pr-reconciliation.js';
import { NEEDS_REMEDIATION_BODY_MARKER } from '../../../src/engine/pr-labels.js';

describe('halt reconciliation ownership boundary', () => {
  it('does not treat an unguarded foreign presentation as healed or cleared', async () => {
    const url = 'https://github.com/acme/widgets/pull/8';
    const gh = vi.fn(async (args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'list') return { stdout: JSON.stringify([{
        number: 8, url, body: NEEDS_REMEDIATION_BODY_MARKER, isDraft: false, labels: [], headRefName: 'feat/daemon-foreign',
      }]) };
      if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ isDraft: false, labels: [], body: NEEDS_REMEDIATION_BODY_MARKER }) };
      throw new Error(`unexpected mutation: ${args.join(' ')}`);
    });
    const cache = new Map();
    await reconcileHaltPrs({ projectRoot: '/fixture', runGh: gh, runGit: async () => { throw new Error('no shipped record'); }, cache });
    expect(cache.get(url)).toBe('unconfirmed');
    expect(gh.mock.calls.filter(([args]) => args[0] === 'api' || args[1] === 'ready' || args[1] === 'edit')).toHaveLength(0);
  });
});

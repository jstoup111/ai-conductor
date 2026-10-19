// Covers: task:55
import { describe, expect, it } from 'vitest';

import { type GitRunner } from '../../../src/engine/rebase.js';
import { readRouteRecord as readRouteRecordThroughReader } from '../../../src/engine/routing/route-record-reader.js';
import { readRouteRecord as readRouteRecordThroughStore } from '../../../src/engine/routing/route-record-store.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';

const roundId = parseRoundId('r1');
if (!roundId) throw new Error('r1 must be a valid route round');

describe('route record reader', () => {
  it('matches the store unreadable result when cat-file cannot read a resolved blob', async () => {
    const git: GitRunner = async (args) => {
      if (args[0] === 'rev-parse') return { exitCode: 0, stdout: `${'a'.repeat(40)}\n`, stderr: '' };
      if (args[0] === 'cat-file') return { exitCode: 128, stdout: '', stderr: 'missing blob' };
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    };

    const fromStore = await readRouteRecordThroughStore('/unused', 'demo', roundId, { git });
    const fromReader = await readRouteRecordThroughReader(git, 'demo', roundId);

    expect(fromStore).toEqual({ kind: 'unreadable' });
    expect(fromReader).toEqual(fromStore);
  });
});

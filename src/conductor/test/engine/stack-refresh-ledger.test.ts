// Covers: task:1
import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import { type GitRunner } from '../../src/engine/rebase.js';
import {
  mergeRefreshLedger,
  readRefreshLedger,
  type RefreshLedger,
} from '../../src/engine/stack-refresh-ledger.js';
import { routingTeardownRefNames } from '../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../src/engine/routing/route-types.js';
import type { CommitSha } from '../../src/engine/restack/restack-types.js';

const c1 = parseChildId(1)!;
const c2 = parseChildId(2)!;
const r1 = parseRoundId('r1')!;
const r2 = parseRoundId('r2')!;
const sha = (character: string): CommitSha => character.repeat(40) as CommitSha;

function reader(blob: string | undefined): GitRunner {
  return async (args) => {
    if (args[0] === 'rev-parse') {
      return blob === undefined
        ? { exitCode: 1, stdout: '', stderr: '' }
        : { exitCode: 0, stdout: `${sha('a')}\n`, stderr: '' };
    }
    if (args[0] === 'cat-file') return { exitCode: 0, stdout: blob!, stderr: '' };
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };
}

const validLedger: RefreshLedger = {
  version: 1,
  members: {
    'feat/c1/demo': { position: c1, publishedTip: sha('1'), recordedTip: sha('2'), pr: 101 },
  },
  rounds: [{ roundId: r1, kind: 'audit', host: c1, marker: '<!-- conductor:routed-fix:r1:101 -->' }],
  aboveOwed: [],
  posted: [],
};

describe('stack refresh ledger', () => {
  it('reads absent, valid, malformed, and unknown-version refresh ledger refs', async () => {
    await expect(readRefreshLedger('/unused', 'demo', { git: reader(undefined) })).resolves.toEqual({ kind: 'absent' });
    await expect(readRefreshLedger('/unused', 'demo', { git: reader(JSON.stringify(validLedger)) })).resolves.toMatchObject({
      kind: 'ledger',
      slug: 'demo',
      ledger: validLedger,
    });
    await expect(readRefreshLedger('/unused', 'demo', { git: reader(JSON.stringify({ ...validLedger, members: { broken: {} } })) })).resolves.toMatchObject({
      kind: 'unreadable', diagnostic: 'malformed-ledger',
    });
    await expect(readRefreshLedger('/unused', 'demo', { git: reader(JSON.stringify({ ...validLedger, version: 2 })) })).resolves.toMatchObject({
      kind: 'unreadable', diagnostic: 'unknown-version',
    });
  });

  it('merges a second pending round without losing published tips and records each latest moved tip', () => {
    const first = mergeRefreshLedger(undefined, {
      moves: [
        { position: c1, branch: 'feat/c1/demo', pr: 101, pushedTip: sha('1'), recordedTip: sha('2') },
        { position: c2, branch: 'feat/daemon-demo', pr: 102, pushedTip: sha('3'), recordedTip: sha('4') },
      ],
      round: { roundId: r1, kind: 'audit', host: c1, marker: '<!-- conductor:routed-fix:r1:101 -->' },
    });

    const merged = mergeRefreshLedger(first, {
      moves: [
        { position: c1, branch: 'feat/c1/demo', pr: 101, pushedTip: sha('1'), recordedTip: sha('5') },
        { position: c2, branch: 'feat/daemon-demo', pr: 102, pushedTip: sha('3'), recordedTip: sha('6') },
      ],
      round: { roundId: r2, kind: 'operator', host: c2, marker: '<!-- conductor:routed-fix:r2:102 -->' },
    });

    expect(merged.rounds).toHaveLength(2);
    expect(merged.members['feat/c1/demo']).toMatchObject({ publishedTip: sha('1'), recordedTip: sha('5') });
    expect(merged.members['feat/daemon-demo']).toMatchObject({ publishedTip: sha('3'), recordedTip: sha('6') });
  });

  it('starts a newly pending move at its current pushed receipt after its previous move settled', () => {
    const settled: RefreshLedger = {
      ...validLedger,
      members: {
        'feat/c1/demo': { position: c1, publishedTip: sha('1'), recordedTip: sha('2'), pr: 101 },
      },
    };

    const merged = mergeRefreshLedger(settled, {
      moves: [{ position: c1, branch: 'feat/c1/demo', pr: 101, pushedTip: sha('2'), recordedTip: sha('3') }],
      round: { roundId: r2, kind: 'audit', host: c1, marker: '<!-- conductor:routed-fix:r2:101 -->' },
    });

    expect(merged.members['feat/c1/demo']).toMatchObject({ publishedTip: sha('2'), recordedTip: sha('3') });
  });

  it('includes the refresh ref in the finite routing teardown enumeration', () => {
    expect(routingTeardownRefNames('demo')).toContain('refs/conductor/demo/refresh');
  });
});

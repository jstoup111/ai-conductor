import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { type LocalGitRunner } from '../../../src/engine/local-git-runner.js';
import { routedRoundOpen } from '../../../src/engine/routing/routed-round-open.js';
import { emptyUnsettledReceipt, parseRoundId, type RouteRecord } from '../../../src/engine/routing/route-types.js';

const sha = 'a'.repeat(40);
const c1 = parseChildId(1)!;
const r1 = parseRoundId('r1')!;

const closedRound: RouteRecord = {
  roundId: r1,
  sealedAuthored: 1,
  kind: 'audit',
  phase: 'closed',
  items: [{ findingId: 'finding-1', kind: 'audit', owner: c1, host: c1, reason: 'task ownership', fallback: [] }],
  allocation: { [c1]: { remTaskIds: ['rem-4'], blockBodies: ['### Task rem-4\n'] } },
  hosts: { [c1]: 'done' },
  currentHostIndex: 0,
  receipt: emptyUnsettledReceipt(),
  outbox: [],
};

function gitFor(options: {
  readonly queue?: 'absent' | 'unreadable' | 'pending';
  readonly routes?: readonly RouteRecord[];
}): LocalGitRunner {
  const routes = options.routes ?? [];
  return async (args) => {
    const ref = args.at(-1);
    if (args[0] === 'rev-parse' && ref === 'refs/conductor/demo/revalidate') {
      if (options.queue === 'unreadable') return { exitCode: 0, stdout: 'invalid\n', stderr: '' };
      if (options.queue === 'pending') return { exitCode: 0, stdout: `${sha}\n`, stderr: '' };
      return { exitCode: 1, stdout: '', stderr: '' };
    }
    if (args[0] === 'cat-file' && options.queue === 'pending') {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          generation: 1,
          entries: [{
            child: 1,
            position: 1,
            closureSha: sha,
            gates: ['test_suite'],
            replay: { oldParent: sha, newParent: sha },
            state: 'queued',
          }],
          outbox: [],
        }),
        stderr: '',
      };
    }
    if (args[0] === 'for-each-ref') {
      return {
        exitCode: 0,
        stdout: routes.map((route) => `refs/conductor/demo/routes/${route.roundId}`).join('\n'),
        stderr: '',
      };
    }
    const route = routes.find((candidate) => ref === `refs/conductor/demo/routes/${candidate.roundId}`);
    if (args[0] === 'rev-parse' && route !== undefined) return { exitCode: 0, stdout: `${sha}\n`, stderr: '' };
    if (args[0] === 'cat-file' && routes.length === 1) return { exitCode: 0, stdout: JSON.stringify(routes[0]), stderr: '' };
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };
}

describe('routed round open predicate', () => {
  it('keeps a published feature eligible while a non-closed route remains durable', async () => {
    const open = { ...closedRound, phase: 'open' as const };

    await expect(routedRoundOpen('/unused', 'demo', { git: gitFor({ routes: [open] }) })).resolves.toBe(true);
    await expect(routedRoundOpen('/unused', 'demo', { git: gitFor({ routes: [closedRound] }) })).resolves.toBe(false);
  });

  it('fails closed for unreadable queue state and pending revalidation work', async () => {
    await expect(routedRoundOpen('/unused', 'demo', { git: gitFor({ queue: 'unreadable' }) })).resolves.toBe(true);
    await expect(routedRoundOpen('/unused', 'demo', { git: gitFor({ queue: 'pending' }) })).resolves.toBe(true);
  });
});

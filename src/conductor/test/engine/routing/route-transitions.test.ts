// Covers: task:100
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { nextRoundId } from '../../../src/engine/routing/route-record-store.js';
import {
  isLegalHostTransition,
  isLegalRoundPhaseTransition,
  parseRoundId,
  type HostState,
  type RoundPhase,
} from '../../../src/engine/routing/route-types.js';
import { routeRecordRefFor } from '../../../src/engine/routing/routing-refs.js';

const hostStates = ['pending', 'admitted', 'repairing', 'reroute-moved', 'built', 'restacked', 'done', 'rerouted'] as const satisfies readonly HostState[];
const roundPhases = ['prepared', 'open', 'closed'] as const satisfies readonly RoundPhase[];
const legalHostTransitions = new Set(['pending:admitted', 'admitted:repairing', 'repairing:reroute-moved', 'repairing:built', 'repairing:done', 'reroute-moved:rerouted', 'built:restacked']);
const legalRoundPhaseTransitions = new Set(['prepared:open', 'open:closed']);

async function createRepo() {
  const repo = await mkdtemp(join(tmpdir(), 'route-transitions-'));
  const git = makeGitRunner(repo);
  try {
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'routing@example.invalid']);
    await git(['config', 'user.name', 'Route transitions']);
    await writeFile(join(repo, 'base.txt'), 'base\n');
    await git(['add', 'base.txt']);
    await git(['commit', '-qm', 'base']);
    return { repo, git };
  } catch (error) {
    await rm(repo, { recursive: true, force: true });
    throw error;
  }
}

async function writeRouteRef(git: GitRunner, round: string): Promise<void> {
  const roundId = parseRoundId(round);
  if (!roundId) throw new Error(`invalid fixture round ${round}`);
  const tip = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await git(['update-ref', routeRecordRefFor('demo', roundId), tip]);
}

describe('routing transitions and round allocation', () => {
  it('accepts only the ADR host-state transition table', () => {
    expect(hostStates.flatMap((from) => hostStates.map((to) => ({
      from,
      to,
      legal: isLegalHostTransition(from, to),
    })))).toEqual(hostStates.flatMap((from) => hostStates.map((to) => ({
      from,
      to,
      legal: legalHostTransitions.has(`${from}:${to}`),
    }))));
  });

  it('accepts only the ADR round-phase transition table', () => {
    expect(roundPhases.flatMap((from) => roundPhases.map((to) => ({
      from,
      to,
      legal: isLegalRoundPhaseTransition(from, to),
    })))).toEqual(roundPhases.flatMap((from) => roundPhases.map((to) => ({
      from,
      to,
      legal: legalRoundPhaseTransitions.has(`${from}:${to}`),
    }))));
  });

  it('allocates the next bounded route round without writing refs', async () => {
    const fixture = await createRepo();
    try {
      const calls: string[][] = [];
      const git: GitRunner = async (args, options) => {
        calls.push([...args]);
        return fixture.git(args, options);
      };
      const writes = () => calls.filter(([command]) => ['hash-object', 'update-ref'].includes(command));
      expect({ result: await nextRoundId(fixture.repo, 'demo', { git }), writes: writes() }).toEqual({ result: 'r1', writes: [] });

      await writeRouteRef(fixture.git, 'r1');
      await writeRouteRef(fixture.git, 'r2');
      calls.length = 0;
      expect({ result: await nextRoundId(fixture.repo, 'demo', { git }), writes: writes() }).toEqual({ result: 'r3', writes: [] });

      await writeRouteRef(fixture.git, 'r999');
      calls.length = 0;
      expect({ result: await nextRoundId(fixture.repo, 'demo', { git }), writes: writes() }).toEqual({
        result: { kind: 'round-limit' },
        writes: [],
      });
    } finally {
      await rm(fixture.repo, { recursive: true, force: true });
    }
  });
});

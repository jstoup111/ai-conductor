// Covers: task:34
import { execFile as execFileCb } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveConflictingPr } from '../../src/engine/autoresolve.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { enrollWatch, readWatch, sweepMergeableLabels } from '../../src/engine/mergeable-sweep.js';
import { RepairQueue } from '../../src/engine/repair-queue.js';
import type { executeRemoteGit } from '../../src/engine/remote-git-operations.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { buildPrFixture, PASSING_SUITE, type PrFixture } from './autoresolve-pr-fixture.js';

const execFile = promisify(execFileCb);
const fixtures: PrFixture[] = [];
const roots: string[] = [];
const originalPath = process.env.PATH;

afterEach(async () => {
  process.env.PATH = originalPath;
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/**
 * Records every git subprocess argv the engine spawns (the local git
 * boundary) while delegating to the real git binary, so the test can prove
 * the published-stack path never starts a replay.
 */
async function installRecordingGit(root: string): Promise<() => Promise<string[]>> {
  const realGit = (await execFile('sh', ['-c', 'command -v git'])).stdout.trim();
  const bin = join(root, 'bin');
  const log = join(root, 'git-argv.log');
  await mkdir(bin, { recursive: true });
  await writeFile(log, '');
  await writeFile(
    join(bin, 'git'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec '${realGit}' "$@"\n`,
  );
  await chmod(join(bin, 'git'), 0o755);
  process.env.PATH = `${bin}${delimiter}${originalPath ?? ''}`;
  return async () => (await readFile(log, 'utf8')).split('\n').filter(Boolean);
}

describe('published stacked leaf PR reached by the mergeable sweep (sweep G4)', () => {
  // Covers: task:34
  it('sweep autoresolve of a conflicting stacked leaf PR runs no rebase, merge-tree or push, escalates and persists restack_refused published-stack #2945', async () => {
    const fixture = await buildPrFixture({
      initial: { 'a.ts': 'base\n' },
      feature: [{ subject: 'feat: stack leaf', files: { 'a.ts': 'feature\n' } }],
      main: { 'a.ts': 'upstream\n' },
    });
    fixtures.push(fixture);
    await mkdir(join(fixture.repo, '.pipeline', 'children', '1'), { recursive: true });
    const watchRoot = await mkdtemp(join(tmpdir(), 'published-stack-sweep-g4-'));
    roots.push(watchRoot);

    const events = new ConductorEventEmitter();
    const eventsPath = join(fixture.repo, '.pipeline', 'events.jsonl');
    const persister = new EventPersister(eventsPath, events);
    persister.start();

    const remoteCalls: string[][] = [];
    const remoteGit: typeof executeRemoteGit = async (args, dependencies) => {
      remoteCalls.push([...args]);
      return fixture.remoteGit(args, dependencies);
    };
    let resolverCalls = 0;
    const entry = { prUrl: fixture.prUrl, slug: 'demo', repoCwd: fixture.repo, resolveAttempts: 1 };
    await enrollWatch(watchRoot, entry);
    const gitArgv = await installRecordingGit(watchRoot);

    try {
      const repairs = new RepairQueue();
      await sweepMergeableLabels({
        projectRoot: watchRoot,
        runGh: fixture.gh,
        operations: fixture.operations,
        tracker: {
          readPullRequestMergeState: async () => ({
            state: 'OPEN', mergeable: 'CONFLICTING', hasFailingOrPendingChecks: false,
            labels: [], checksOutcome: 'none' as const, isDraft: false,
            mergeStateStatus: 'DIRTY', baseRefName: 'main',
          }),
        },
        autoresolve: {
          enabled: true,
          isEligible: async () => ({ eligible: true }),
          dispatch: async (watched) => resolveConflictingPr(
            watched,
            'feature',
            { enabled: true, suiteCommand: 'npm test', cooldownMinutes: 0, attemptCap: 3 },
            {
              runGh: fixture.gh,
              operations: fixture.operations,
              remoteGit,
              events,
              runSuite: PASSING_SUITE,
              resolver: async () => {
                resolverCalls++;
                return { resolved: false, reason: 'unreachable' };
              },
              log: fixture.log,
            },
          ),
        },
        repairs: { queue: repairs },
      });
      const [queued] = repairs.list();
      const request = queued && repairs.takeByUrl(queued.prUrl);
      expect(request).toBeDefined();
      await request!.run(entry);
    } finally {
      persister.stop();
    }

    const argv = await gitArgv();
    expect(argv.filter((line) => /^(rebase|merge-tree|push)\b/.test(line)
      || /\s(rebase|merge-tree|push)(\s|$)/.test(line))).toEqual([]);
    expect(remoteCalls).toEqual([]);
    expect(await fixture.pushes()).toBe(0);
    expect(resolverCalls).toBe(0);

    // Escalated to a human through `escalate`: needs-remediation label and the
    // marker-tagged escalation comment naming the published-stack stage.
    expect(fixture.ghCalls.some((args) => args.join(' ').includes('labels[]=needs-remediation'))).toBe(true);
    const escalation = fixture.commentBodies().find((body) => body.includes('## Escalation: manual remediation required'));
    expect(escalation).toContain('**Stage:** published-stack');
    expect(escalation).toContain('#2945');

    const persisted = (await readFile(eventsPath, 'utf8')).trim().split('\n')
      .map((line) => JSON.parse(line) as { type: string; reason?: string; detail?: string });
    expect(persisted.filter((event) => event.type === 'restack_refused')).toEqual([
      expect.objectContaining({ type: 'restack_refused', reason: 'published-stack', detail: '#2945' }),
    ]);
    expect((await readWatch(watchRoot))[0]?.resolveAttempts).toBe(1);
  });
});

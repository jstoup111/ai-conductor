import { describe, expect, it } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import {
  emitExcusedRebaseCitationResidue,
  resolveConflictingPr,
  runAcceptanceGuards,
} from '../../src/engine/autoresolve.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { startFeatureEventPersistence } from '../../src/engine/event-persister.js';
import {
  PASSING_SUITE,
  buildPrFixture,
  settleAndContinue,
  skipReplay,
  type PrFixture,
} from './autoresolve-pr-fixture.js';

const execFile = promisify(execFileCb);

describe('engine/autoresolve — sweep supersession preservation mode', () => {
  it('takes citation-residue reasons from the supplied guard result', async () => {
    const emitted: unknown[] = [];
    const excused = [{
      sha: 'a'.repeat(40),
      subject: 'test: supplied guard reason',
      reason: 'future-declared-reason',
      paths: ['supplied.test.ts'],
    }];

    await emitExcusedRebaseCitationResidue(
      { emit: async (event: Parameters<ConductorEventEmitter['emit']>[0]) => { emitted.push(event); } } as never,
      excused,
    );

    expect(emitted).toEqual([{
      type: 'rebase_citation_residue',
      residue: [{
        sha: 'a'.repeat(40),
        citingTaskIds: [],
        reason: 'future-declared-reason',
      }],
    }]);
  });

  it('keeps a bare strict-path resolution on the legacy no-declarations guard call', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'autoresolve-supersession-'));
    const git = (args: string[]) => execFile('git', args, { cwd: repo });
    try {
      await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
      await git(['config', 'user.email', 't@example.test']);
      await git(['config', 'user.name', 'Test']);
      await writeFile(join(repo, 'test-only.test.ts'), 'initial\n');
      await git(['add', '.']);
      await git(['commit', '-q', '-m', 'init']);

      await git(['checkout', '-q', '-b', 'feature']);
      await writeFile(join(repo, 'test-only.test.ts'), 'upstream-equivalent\n');
      await git(['commit', '-q', '-am', 'test: upstream-equivalent change']);

      await git(['checkout', '-q', 'main']);
      await writeFile(join(repo, 'test-only.test.ts'), 'upstream-equivalent\n');
      await git(['commit', '-q', '-am', 'main: land equivalent change']);

      const gh: GhRunner = async (args) => ({
        stdout: args[0] === 'pr' && args[1] === 'view'
          ? JSON.stringify({ comments: [] })
          : '',
      });
      let suiteRuns = 0;
      const outcome = await resolveConflictingPr(
        { prUrl: 'https://github.com/example/repo/pull/42', slug: 'feature', repoCwd: repo },
        'feature',
        { enabled: true, suiteCommand: 'unused', cooldownMinutes: 0, attemptCap: 1 },
        {
          runGh: gh,
          runSuite: async () => {
            suiteRuns += 1;
            return { exitCode: 0, durationMs: 0, configured: true };
          },
          resolver: async () => ({ resolved: false, reason: 'not reached' }),
          log: () => undefined,
        },
      );

      // Strict paths now omit the fourth guard argument rather than turning an
      // unsolicited resolver result into a declaration. The legacy guard
      // therefore reaches suite verification before the fixture's no-remote
      // publish failure escalates it.
      expect(outcome).toEqual({ kind: 'escalated' });
      expect(suiteRuns).toBe(1);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it.each([
    { mode: 'strict', choice: 'superseded' as const, rationale: 'upstream already contains the resolved content', path: 'app.ts', guardArgumentCount: 3 },
    { mode: 'strict', choice: 'merged' as const, rationale: 'the strict resolver merged both edits', path: 'app.ts', guardArgumentCount: 3 },
    { mode: 'judgement', choice: 'source' as const, rationale: 'the test-only resolver retained the source edit', path: 'app.test.ts', guardArgumentCount: 4 },
  ])('$mode resolution handles a schema-valid $choice verdict with the correct guard mode', async ({
    mode,
    choice,
    rationale,
    path,
    guardArgumentCount,
  }) => {
    const repo = await mkdtemp(join(tmpdir(), 'autoresolve-strict-verdict-'));
    const git = (args: string[]) => execFile('git', args, { cwd: repo });
    const prUrl = 'https://github.com/example/repo/pull/43';
    try {
      await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
      const remote = join(repo, 'remote.git');
      await execFile('git', ['init', '--bare', '-q', '-b', 'main', remote]);
      await execFile('git', ['config', 'core.logAllRefUpdates', 'true'], { cwd: remote });
      await git(['config', 'user.email', 't@example.test']);
      await git(['config', 'user.name', 'Test']);
      await git(['remote', 'add', 'origin', remote]);
      await writeFile(join(repo, path), 'initial\n');
      await git(['add', '.']);
      await git(['commit', '-q', '-m', 'init']);

      await git(['checkout', '-q', '-b', 'feature']);
      await writeFile(join(repo, path), 'feature change\n');
      await git(['commit', '-q', '-am', `feat: feature ${mode} change`]);

      await git(['checkout', '-q', 'main']);
      await writeFile(join(repo, path), 'main change\n');
      await git(['commit', '-q', '-am', `main: conflicting ${mode} change`]);
      await git(['push', '-q', 'origin', 'main', 'feature']);

      const ghCalls: string[][] = [];
      const gh: GhRunner = async (args) => {
        ghCalls.push(args);
        return {
          stdout: args[0] === 'pr' && args[1] === 'view'
            ? JSON.stringify({ comments: [] })
            : '',
        };
      };
      const emitted: unknown[] = [];
      const logs: string[] = [];
      const guardCalls: Parameters<typeof runAcceptanceGuards>[] = [];
      const outcome = await resolveConflictingPr(
        { prUrl, slug: `feature-${choice}`, repoCwd: repo },
        'feature',
        { enabled: true, suiteCommand: 'unused', cooldownMinutes: 0, attemptCap: 1 },
        {
          runGh: gh,
          runSuite: async () => ({ exitCode: 0, durationMs: 0, configured: true }),
          resolver: async ({ projectRoot }) => {
            await writeFile(join(projectRoot, path), `resolved ${mode} path\n`);
            await execFile('git', ['add', path], { cwd: projectRoot });
            await execFile('git', ['-c', 'core.editor=true', 'rebase', '--continue'], { cwd: projectRoot });
            return { resolved: true, verdict: { choice, rationale, superseded: [] } };
          },
          log: (message) => logs.push(message),
          events: { emit: async (event: Parameters<ConductorEventEmitter['emit']>[0]) => { emitted.push(event); } } as never,
          runAcceptanceGuards: async (...args) => {
            guardCalls.push(args);
            return runAcceptanceGuards(...args);
          },
        },
      );

      expect(outcome).toEqual({ kind: 'refreshed' });
      const reflog = await execFile('git', ['reflog', 'show', '--format=%H', 'refs/heads/feature'], { cwd: remote });
      expect(reflog.stdout.trim().split('\n')).toHaveLength(2);
      expect(guardCalls).toHaveLength(1);
      expect(guardCalls[0]).toHaveLength(guardArgumentCount);
      if (mode === 'strict') {
        expect(ghCalls.some((args) => args[0] === 'pr' && args[1] === 'comment')).toBe(false);
        expect(emitted).toEqual([]);
        expect(logs.filter((message) => message.includes(prUrl) && message.includes('ignored'))).toHaveLength(1);
      } else {
        // Task 18: every test-only sweep resolution enters judgement mode,
        // even when the accepted verdict declares no superseded commits.
        expect(guardCalls[0][3]).toEqual([]);
      }
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('publishes every attempt\'s declared-superseded commit when judgement spans several resolver calls', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'autoresolve-multi-attempt-'));
    const git = (args: string[]) => execFile('git', args, { cwd: repo });
    const prUrl = 'https://github.com/example/repo/pull/44';
    try {
      await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
      const remote = join(repo, 'remote.git');
      await execFile('git', ['init', '--bare', '-q', '-b', 'main', remote]);
      await git(['config', 'user.email', 't@example.test']);
      await git(['config', 'user.name', 'Test']);
      await git(['remote', 'add', 'origin', remote]);
      await writeFile(join(repo, 'first.test.ts'), 'initial\n');
      await writeFile(join(repo, 'second.test.ts'), 'initial\n');
      await git(['add', 'first.test.ts', 'second.test.ts']);
      await git(['commit', '-q', '-m', 'init']);

      await git(['checkout', '-q', '-b', 'feature']);
      await writeFile(join(repo, 'first.test.ts'), 'feature first\n');
      await git(['commit', '-q', '-am', 'test: first superseded change']);
      const supersededSha = (await git(['rev-parse', 'HEAD'])).stdout.trim();
      await writeFile(join(repo, 'second.test.ts'), 'feature second\n');
      await git(['commit', '-q', '-am', 'test: second merged change']);

      await git(['checkout', '-q', 'main']);
      await writeFile(join(repo, 'first.test.ts'), 'main first\n');
      await writeFile(join(repo, 'second.test.ts'), 'main second\n');
      await git(['commit', '-q', '-am', 'main: conflicting test changes']);
      await git(['push', '-q', 'origin', 'main', 'feature']);

      const ghCalls: string[][] = [];
      const gh: GhRunner = async (args) => {
        ghCalls.push(args);
        return {
          stdout: args[0] === 'pr' && args[1] === 'view'
            ? JSON.stringify({ comments: [] })
            : '',
        };
      };
      const emitted: Array<{ type: string; superseded?: string[]; choice?: string }> = [];
      let calls = 0;
      const outcome = await resolveConflictingPr(
        { prUrl, slug: 'feature-multi-attempt', repoCwd: repo },
        'feature',
        { enabled: true, suiteCommand: 'npm test', cooldownMinutes: 0, attemptCap: 3 },
        {
          runGh: gh,
          runSuite: async () => ({ exitCode: 0, durationMs: 0, configured: true }),
          resolver: async ({ projectRoot, supersessionJudgement }) => {
            calls += 1;
            expect(supersessionJudgement).toBe(true);
            if (calls === 1) {
              // Upstream already carries the first commit's intent: drop it.
              await execFile('git', ['checkout', '--ours', 'first.test.ts'], { cwd: projectRoot });
              await execFile('git', ['add', 'first.test.ts'], { cwd: projectRoot });
              await execFile('git', ['-c', 'core.editor=true', 'rebase', '--skip'], { cwd: projectRoot })
                .catch(() => undefined);
              return {
                resolved: true,
                verdict: { choice: 'superseded', rationale: 'main already covers the first test', superseded: [supersededSha] },
              };
            }
            await writeFile(join(projectRoot, 'second.test.ts'), 'main second\nfeature second\n');
            await execFile('git', ['add', 'second.test.ts'], { cwd: projectRoot });
            await execFile('git', ['-c', 'core.editor=true', 'rebase', '--continue'], { cwd: projectRoot });
            return {
              resolved: true,
              verdict: { choice: 'merged', rationale: 'kept both second-test edits', superseded: [] },
            };
          },
          log: () => undefined,
          events: {
            emit: async (event: Parameters<ConductorEventEmitter['emit']>[0]) => { emitted.push(event as never); },
          } as never,
        },
      );

      expect(calls).toBe(2);
      expect(outcome).toEqual({ kind: 'refreshed' });
      const verdictEvents = emitted.filter((event) => event.type === 'rebase_supersession_verdict');
      expect(verdictEvents).toHaveLength(1);
      expect(verdictEvents[0].superseded).toEqual([supersededSha]);
      expect(verdictEvents[0].choice).toBe('superseded');
      const audit = ghCalls.find((args) => args[0] === 'pr' && args[1] === 'comment');
      const body = audit?.[audit.indexOf('--body') + 1] ?? '';
      expect(body).toContain(supersededSha);
      expect(body).toContain('main already covers the first test');
      expect(body).toContain('kept both second-test edits');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

// Covers: task:6, task:7, task:8, task:10
describe('engine/autoresolve — resolveConflictingPr sweep judgement flow (real git, stubbed gh)', () => {
  const testOnly = () => buildPrFixture({
    initial: { 'rewrite.test.ts': 'base\n' },
    feature: [{ subject: 'test: rewrite assertion', files: { 'rewrite.test.ts': 'feature\n' } }],
    main: { 'rewrite.test.ts': 'upstream\n' },
  });
  const config = { enabled: true, suiteCommand: 'npm test', cooldownMinutes: 0, attemptCap: 2 };
  const run = (fx: PrFixture, resolver: Parameters<typeof resolveConflictingPr>[3]['resolver'], extra: Partial<Parameters<typeof resolveConflictingPr>[3]> = {}) =>
    resolveConflictingPr(
      { prUrl: fx.prUrl, slug: 'feature', repoCwd: fx.repo },
      'feature',
      config,
      { runGh: fx.gh, runSuite: PASSING_SUITE, resolver, log: fx.log, events: fx.events, ...extra },
    );

  it('S1.1: publishes a declared test-only supersession with one lease push and a non-halt tier-2 outcome', async () => {
    const fx = await testOnly();
    try {
      const guardResults: Awaited<ReturnType<typeof runAcceptanceGuards>>[] = [];
      const outcome = await run(fx, async ({ projectRoot }) => {
        await skipReplay(projectRoot);
        return { resolved: true, verdict: { choice: 'superseded', rationale: 'upstream rewrote the assertion', superseded: [fx.shas[0]] } };
      }, {
        runAcceptanceGuards: async (...args) => {
          const result = await runAcceptanceGuards(...args);
          guardResults.push(result);
          return result;
        },
      });

      expect(outcome).toEqual({ kind: 'refreshed' });
      expect(await fx.pushes()).toBe(1);
      const tier2 = fx.logs.filter((line) => line.includes('tier2 outcome:'));
      expect(tier2).toHaveLength(1);
      expect(tier2[0]).not.toContain('conflict_halt');
      expect(guardResults).toEqual([expect.objectContaining({ ok: true, excused: [expect.objectContaining({ sha: fx.shas[0] })] })]);
    } finally {
      await fx.cleanup();
    }
  });

  it('S1.2: publishes a merged test-only resolution with no excused commit and no residue', async () => {
    const fx = await testOnly();
    try {
      const guardResults: Awaited<ReturnType<typeof runAcceptanceGuards>>[] = [];
      const outcome = await run(fx, async ({ projectRoot }) => {
        await settleAndContinue(projectRoot, { 'rewrite.test.ts': 'upstream\nfeature\n' });
        return { resolved: true, verdict: { choice: 'merged', rationale: 'kept both assertions', superseded: [] } };
      }, {
        runAcceptanceGuards: async (...args) => {
          const result = await runAcceptanceGuards(...args);
          guardResults.push(result);
          return result;
        },
      });

      expect(outcome).toEqual({ kind: 'refreshed' });
      expect(await fx.pushes()).toBe(1);
      expect(guardResults).toEqual([{ ok: true, excused: [] }]);
      expect(fx.emitted.filter((event) => event.type === 'rebase_citation_residue')).toEqual([]);
    } finally {
      await fx.cleanup();
    }
  });

  it('S1.4: forwards an unresolved intent conflict verbatim into the escalation comment without pushing', async () => {
    const fx = await testOnly();
    try {
      const items = [
        `replay commit ${'1'.repeat(7)} "test: rewrite assertion"`,
        'file rewrite.test.ts lines 1-1',
        'ours expects the upstream value',
        'theirs expects the feature value',
        'missing decision: which value the product now returns',
      ];
      const outcome = await run(fx, async () => ({ resolved: false, reason: items.join('; ') }));

      expect(outcome).toEqual({ kind: 'escalated' });
      expect(await fx.pushes()).toBe(0);
      const body = fx.commentBodies().join('\n');
      expect(body).toContain('**Stage:** tier2-resolve');
      for (const item of items) expect(body).toContain(item);
    } finally {
      await fx.cleanup();
    }
  });

  it('S3.3: escalates an undeclared drop at the acceptance-guards stage naming the subject, without pushing', async () => {
    const fx = await testOnly();
    try {
      const outcome = await run(fx, async ({ projectRoot }) => {
        await skipReplay(projectRoot);
        return { resolved: true, verdict: { choice: 'merged', rationale: 'claims nothing was dropped', superseded: [] } };
      });

      expect(outcome).toEqual({ kind: 'escalated' });
      expect(await fx.pushes()).toBe(0);
      const body = fx.commentBodies().join('\n');
      expect(body).toContain('**Stage:** acceptance-guards');
      expect(body).toContain('test: rewrite assertion');
    } finally {
      await fx.cleanup();
    }
  });

  it('S3.2: records each excused commit as rebase residue and persists it to the feature event log', async () => {
    const fx = await testOnly();
    const featureWorktree = join(fx.repo, '.feature-worktree');
    const bus = new ConductorEventEmitter();
    const scope = startFeatureEventPersistence(featureWorktree, bus, 'feature');
    try {
      const outcome = await run(fx, async ({ projectRoot }) => {
        await skipReplay(projectRoot);
        return { resolved: true, verdict: { choice: 'superseded', rationale: 'upstream rewrote the assertion', superseded: [fx.shas[0]] } };
      }, { events: scope.events });
      scope.stop();

      expect(outcome).toEqual({ kind: 'refreshed' });
      const lines = (await readFile(join(featureWorktree, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line) as { type: string; residue?: Array<{ sha: string; reason: string }> });
      const residue = lines.filter((line) => line.type === 'rebase_citation_residue');
      expect(residue).toHaveLength(1);
      expect(residue[0].residue).toEqual([expect.objectContaining({ sha: fx.shas[0], reason: 'declared-superseded-test-only' })]);
    } finally {
      scope.stop();
      await fx.cleanup();
    }
  });

  it('S3.2: the daemon sweep binding hands resolution a feature-scoped persisted bus', async () => {
    const source = await readFile(new URL('../../src/daemon-cli.ts', import.meta.url), 'utf8');
    const scopeAt = source.indexOf('const featureScope = startFeatureEventPersistence(');
    const callAt = source.indexOf('await resolveConflictingPr(', scopeAt);
    expect(scopeAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(scopeAt);
    expect(source.slice(callAt, source.indexOf(');', callAt))).toContain('events: featureScope.events');
  });
});

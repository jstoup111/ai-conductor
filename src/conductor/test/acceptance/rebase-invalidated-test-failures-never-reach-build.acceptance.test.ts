/**
 * Acceptance coverage for #1535: rebase-invalidated failures must become
 * durable, causally joined repair evidence before build_review grades the
 * repaired diff.
 *
 * Multi-step story flows covered here:
 * - Stories 1/2/3: production rebase emission -> EventPersister -> the
 *   feature's append-only `.pipeline/events.jsonl`, including a docs-only
 *   base advance that preserves gate verdicts.
 * - Stories 4/5: durable advance history -> deterministic gate failure ->
 *   gate-agnostic repair ledger, with unrelated failures left unattributed.
 * - Stories 6/7: repair ledger -> production build-review input assembly ->
 *   grader prompt + persisted grading-provenance event.
 *
 * Single-operation classifier, schema, malformed-ledger, lock, and legacy-
 * normalization cases remain owned by the plan's lower-layer TDD tasks.
 *
 * Correctness-critical production call sites exercised:
 * - src/engine/rebase.ts: emitRebaseEvent / applyRebaseVerdicts
 * - src/engine/event-persister.ts: EventPersister.start
 * - src/engine/test-suite-remediation.ts: deterministic failure attribution
 * - src/engine/build-review-inputs.ts: assembleBuildReviewInputs
 * - src/engine/build-review-prompt.ts: buildGraderPrompt
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { assembleBuildReviewInputs } from '../../src/engine/build-review-inputs.js';
import { buildGraderPrompt } from '../../src/engine/build-review-prompt.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { readVerdict, writeVerdict } from '../../src/engine/gate-verdicts.js';
import {
  applyRebaseVerdicts,
  emitRebaseEvent,
  makeGitRunner,
  performRebase,
  type GitRunner,
  type RebaseOutcome,
} from '../../src/engine/rebase.js';
import * as remediation from '../../src/engine/test-suite-remediation.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const dirs: string[] = [];
const execFile = promisify(execFileCb);

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeFeatureRoot(prefix: string): Promise<{
  root: string;
  events: ConductorEventEmitter;
  persister: EventPersister;
  eventsPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(root);
  const eventsPath = join(root, '.pipeline', 'events.jsonl');
  const events = new ConductorEventEmitter();
  const persister = new EventPersister(eventsPath, events);
  persister.start();
  return { root, events, persister, eventsPath };
}

async function readEvents(eventsPath: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(eventsPath, 'utf8').catch(() => '');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function buildReviewGit(): GitRunner {
  return async (args) => {
    const command = args.join(' ');
    if (command === 'remote') return { exitCode: 0, stdout: '', stderr: '' };
    if (command === 'merge-base main HEAD') {
      return { exitCode: 0, stdout: 'base-sha\n', stderr: '' };
    }
    if (command.startsWith('diff base-sha..HEAD -- . ')) {
      return {
        exitCode: 0,
        stdout: [
          'diff --git a/test/obsolete.test.ts b/test/obsolete.test.ts',
          'deleted file mode 100644',
          '--- a/test/obsolete.test.ts',
          '+++ /dev/null',
        ].join('\n'),
        stderr: '',
      };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  };
}

describe('rebase-invalidated failures reach build_review as bounded repair context', () => {
  it('persists every base advance while documentation-only advances preserve gate verdicts', async () => {
    const { root, events, persister, eventsPath } = await makeFeatureRoot('rebase-advance-ledger-');
    try {
      const git = (args: string[]) => execFile('git', args, { cwd: root, encoding: 'utf8' as const });
      await git(['init', '-q', '-b', 'main']);
      await git(['config', 'user.email', 'acceptance@example.com']);
      await git(['config', 'user.name', 'Acceptance']);
      await git(['config', 'commit.gpgsign', 'false']);
      await writeFile(join(root, '.gitignore'), '.pipeline/\n');
      await writeFile(join(root, 'base.ts'), 'export const base = true;\n');
      await git(['add', '.']);
      await git(['commit', '-q', '-m', 'initial']);
      await git(['checkout', '-q', '-b', 'feature']);
      await writeFile(join(root, 'feature.ts'), 'export const feature = true;\n');
      await git(['add', '.']);
      await git(['commit', '-q', '-m', 'feature']);
      await git(['checkout', '-q', 'main']);
      await mkdir(join(root, 'agents'), { recursive: true });
      await writeFile(join(root, 'agents', 'planner.md'), 'runtime instructions\n');
      await git(['add', '.']);
      await git(['commit', '-q', '-m', 'advance runtime markdown']);
      await git(['checkout', '-q', 'feature']);

      await writeVerdict(root, 'build_review', {
        satisfied: true,
        checkedAt: 101,
        reason: 'graded before the documentation-only base advance',
      });
      const verdictPath = join(root, '.pipeline', 'gates', 'build_review.json');
      const before = await readFile(verdictPath, 'utf8');

      const sourceAdvance = await performRebase(makeGitRunner(root), root, 'main');
      await emitRebaseEvent(events, sourceAdvance);
      await events.emit({
        type: 'rebase_gate_invalidated',
        gate: 'build_review',
        matchedPaths: ['agents/planner.md'],
      });

      await git(['checkout', '-q', 'main']);
      await mkdir(join(root, '.docs', 'audits'), { recursive: true });
      await mkdir(join(root, 'docs'), { recursive: true });
      await writeFile(join(root, '.docs', 'audits', 'base.json'), '{}\n');
      await writeFile(join(root, 'docs', '_config.yml'), 'title: Docs\n');
      await git(['add', '.']);
      await git(['commit', '-q', '-m', 'advance documentation']);
      await git(['checkout', '-q', 'feature']);
      const docsOnlyAdvance = await performRebase(makeGitRunner(root), root, 'main');
      await emitRebaseEvent(events, docsOnlyAdvance);
      const verdict = await applyRebaseVerdicts(root, docsOnlyAdvance, false);

      const ledger = await readEvents(eventsPath);
      const advances = ledger.filter((event) => event.type === 'rebase_changed');
      expect(advances).toHaveLength(2);
      expect(advances[0]).toMatchObject({
        type: 'rebase_changed',
        changedPaths: ['agents/planner.md'],
      });
      const completePaths = (event: Record<string, unknown>): string[] | undefined =>
        Object.entries(event).find(([key, value]) =>
          key !== 'changedPaths' && Array.isArray(value) && value.every((path) => typeof path === 'string')
        )?.[1] as string[] | undefined;
      expect(completePaths(advances[0]!)).toEqual(['agents/planner.md']);
      expect(completePaths(advances[1]!)).toEqual([
        '.docs/audits/base.json',
        'docs/_config.yml',
      ]);
      expect(ledger).toContainEqual(expect.objectContaining({
        type: 'rebase_gate_invalidated',
        gate: 'build_review',
        matchedPaths: ['agents/planner.md'],
      }));
      expect(verdict.kickedBack).toEqual([]);
      expect(await readFile(verdictPath, 'utf8')).toBe(before);
    } finally {
      persister.stop();
    }
  });

  it('joins later gate failures to the matching advance, retains distinct repairs, and rejects unrelated work', async () => {
    const { root, events, persister, eventsPath } = await makeFeatureRoot('rebase-repair-join-');
    try {
      await emitRebaseEvent(events, {
        kind: 'changed',
        changedCodePaths: ['agents/planner.md'],
        featureSurface: ['agents/planner.md'],
        allChangedPaths: ['agents/planner.md', 'test/obsolete.test.ts'],
      } as unknown as RebaseOutcome);

      const advance = (await readEvents(eventsPath)).find((event) => event.type === 'rebase_changed');
      expect(advance).toBeDefined();

      const recordGateRepair = (remediation as Record<string, unknown>).recordGateRepair;
      expect(recordGateRepair).toBeTypeOf('function');
      const record = recordGateRepair as (
        projectRoot: string,
        gate: string,
        failure: { reason: string; message: string; observedAt: number },
      ) => Promise<unknown>;
      const observedAt = Date.parse(String(advance?.ts)) + 1_000;

      await record(root, 'test_suite', {
        reason: 'test_failure',
        message: 'ENOENT agents/planner.md',
        observedAt,
      });
      await record(root, 'wiring_check', {
        reason: 'missing_coverage',
        message: 'test/obsolete.test.ts was deleted by the advanced base',
        observedAt: observedAt + 1,
      });
      await record(root, 'test_suite', {
        reason: 'test_failure',
        message: 'ENOENT agents/planner.md',
        observedAt: observedAt + 2,
      });
      await record(root, 'test_suite', {
        reason: 'test_failure',
        message: 'unplanned deletion: test/unrelated.test.ts',
        observedAt: observedAt + 3,
      });

      const repairs = await remediation.readTestSuiteRemediations(root);
      expect(repairs).toHaveLength(2);
      expect(repairs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          gate: 'test_suite',
          diagnostic: expect.stringContaining('agents/planner.md'),
        }),
        expect.objectContaining({
          gate: 'wiring_check',
          diagnostic: expect.stringContaining('test/obsolete.test.ts'),
        }),
      ]));
      expect(repairs.some((repair) => repair.diagnostic.includes('unrelated.test.ts'))).toBe(false);
    } finally {
      persister.stop();
    }
  });

  it('feeds all matched repairs to the real grader input path and records how grading was contextualized', async () => {
    const { root, events, persister, eventsPath } = await makeFeatureRoot('rebase-review-context-');
    try {
      const planPath = join(root, '.docs', 'plans', 'feature.md');
      await mkdir(join(root, '.docs', 'plans'), { recursive: true });
      await writeFile(planPath, '# Approved plan\n\nRepair base-invalidated coverage.\n', 'utf8');

      await emitRebaseEvent(events, {
        kind: 'changed',
        changedCodePaths: ['agents/planner.md'],
        featureSurface: ['agents/planner.md'],
        allChangedPaths: ['agents/planner.md', 'test/obsolete.test.ts'],
      } as unknown as RebaseOutcome);
      const advance = (await readEvents(eventsPath)).find((event) => event.type === 'rebase_changed');

      const recordGateRepair = (remediation as Record<string, unknown>).recordGateRepair;
      expect(recordGateRepair).toBeTypeOf('function');
      const record = recordGateRepair as (
        projectRoot: string,
        gate: string,
        failure: { reason: string; message: string; observedAt: number },
      ) => Promise<unknown>;
      const observedAt = Date.parse(String(advance?.ts)) + 1_000;
      await record(root, 'test_suite', {
        reason: 'test_failure',
        message: 'ENOENT agents/planner.md',
        observedAt,
      });
      await record(root, 'wiring_check', {
        reason: 'missing_coverage',
        message: 'test/obsolete.test.ts disappeared after the base advance',
        observedAt: observedAt + 1,
      });

      const inputs = await (assembleBuildReviewInputs as unknown as (
        git: GitRunner,
        plan: string,
        events: ConductorEventEmitter,
      ) => ReturnType<typeof assembleBuildReviewInputs>)(buildReviewGit(), planPath, events);
      const prompt = buildGraderPrompt(inputs);
      const ledger = await readEvents(eventsPath);

      expect(inputs.repairContext).toHaveLength(2);
      for (const repair of inputs.repairContext ?? []) {
        expect(prompt).toContain(repair.id);
        expect(prompt).toContain(repair.diagnostic);
      }
      expect(prompt).toContain('This context is evidence, not an exemption');
      expect(prompt).toContain('Unmatched work remains subject to every rubric');
      expect(ledger).toContainEqual(expect.objectContaining({
        type: 'build_review_repair_context',
        disposition: 'context_available',
        repairCount: 2,
      }));
    } finally {
      persister.stop();
    }
  });
});

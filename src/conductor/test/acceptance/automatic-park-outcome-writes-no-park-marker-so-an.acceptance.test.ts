/**
 * Acceptance specs for
 * .docs/stories/automatic-park-outcome-writes-no-park-marker-so-an.md.
 *
 * These specs drive the real `makeRunFeature` production entry point, then
 * observe the durable marker through the real backlog, reconciliation, and
 * provenance readers. Only the setup-triage outcome and the daemon's process /
 * provider boundaries are injected; filesystem and local Git behavior are real.
 *
 * Existing lower-level coverage is deliberately not duplicated here:
 * - marker EEXIST idempotence, concurrent distinct-slug writes, main-root
 *   resolution, and operator unpark are covered by
 *   park-marker-main-root-resolution.acceptance.test.ts and park-marker.test.ts;
 * - reconciliation orphan/record-missing/unreadable-marker cases are covered by
 *   parked-feature-reconciliation.acceptance.test.ts;
 * - the note-render ordering and HALT verification-read failure are
 *   single-boundary cases owned by daemon-runner.test.ts during TDD.
 *
 * RED reason before implementation: `makeRunFeature` writes a HALT that claims
 * every error is parked, but never routes the triage-park outcome through
 * `writeAutoPark`. The specs execute and fail on the missing/false observable
 * state, never at import or collection.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  makeRunFeature,
  type FeatureRunnerDeps,
  type WorktreeOutcome,
} from '../../src/engine/daemon-runner.js';
import { discoverBacklog } from '../../src/engine/daemon-backlog.js';
import {
  getProvenanceType,
  removeOperatorPark,
} from '../../src/engine/park-marker.js';
import { reconcileParkedFeatures } from '../../src/engine/park-reconciliation.js';
import { SetupFailureError } from '../../src/engine/worktree-prepare.js';
import type { BacklogItem } from '../../src/engine/daemon.js';
import type { TriageOutcome } from '../../src/engine/setup-triage.js';

const execFile = promisify(execFileCallback);
const SLUG = 'automatic-park-boundary';
const ITEM: BacklogItem = { slug: SLUG };

interface RunRecord {
  conductorCalls: number;
  triageCalls: number;
  teardownKeeps: boolean[];
  escalations: string[];
  logs: string[];
}

function freshRecord(): RunRecord {
  return {
    conductorCalls: 0,
    triageCalls: 0,
    teardownKeeps: [],
    escalations: [],
    logs: [],
  };
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

describe('automatic park termination — real runner to durable daemon consumers', () => {
  let projectRoot: string;
  let worktreePath: string;

  const git = async (args: string[], cwd = projectRoot): Promise<string> => {
    const { stdout } = await execFile('git', args, { cwd });
    return stdout.trim();
  };

  const markerPath = (): string => join(projectRoot, '.daemon', 'parked', SLUG);
  const haltPath = (): string => join(worktreePath, '.pipeline', 'HALT');
  const haltClassPath = (): string => join(worktreePath, '.pipeline', 'HALT.class');

  async function writeMergedSpec(): Promise<void> {
    await mkdir(join(projectRoot, '.docs', 'plans'), { recursive: true });
    await mkdir(join(projectRoot, '.docs', 'stories'), { recursive: true });
    await mkdir(join(projectRoot, '.docs', 'complexity'), { recursive: true });
    await mkdir(join(projectRoot, '.docs', 'track'), { recursive: true });
    await mkdir(join(projectRoot, '.docs', 'coherence'), { recursive: true });
    await mkdir(join(projectRoot, '.docs', 'intake'), { recursive: true });

    await writeFile(
      join(projectRoot, '.docs', 'plans', `${SLUG}.md`),
      `# Plan\n**Stories:** .docs/stories/${SLUG}.md\n\n### Task 1\n**Dependencies:** none\n`,
    );
    await writeFile(
      join(projectRoot, '.docs', 'stories', `${SLUG}.md`),
      '# Stories\n\n**Status:** Accepted\n',
    );
    await writeFile(
      join(projectRoot, '.docs', 'complexity', `${SLUG}.md`),
      '# Complexity\n\nTier: M\n',
    );
    await writeFile(
      join(projectRoot, '.docs', 'track', `${SLUG}.md`),
      '# Track\n\nTrack: technical\n',
    );
    await writeFile(
      join(projectRoot, '.docs', 'coherence', `${SLUG}.md`),
      '| Row | Source | Target | Verdict | Notes |\n' +
        '|---|---|---|---|---|\n' +
        '| story | S1 | Task 1 | covered | fixture |\n',
    );
    await writeFile(
      join(projectRoot, '.docs', 'intake', `${SLUG}.md`),
      '# Intake\n\nSource-Ref: acme/project#1328\n',
    );
    await git(['add', '.docs']);
    await git(['commit', '-q', '-m', 'merge automatic-park spec']);
    await git(['update-ref', 'refs/remotes/origin/main', 'main']);
  }

  async function discoverSlugs(): Promise<string[]> {
    const result = await discoverBacklog(projectRoot, async () => false, () => {}, {
      baseBranch: 'main',
    });
    return result.items.map((item) => item.slug);
  }

  function depsFor(opts: {
    record: RunRecord;
    triage?: TriageOutcome;
    prepareError?: Error;
    outcome?: WorktreeOutcome;
  }): FeatureRunnerDeps {
    const { record } = opts;
    return {
      createWorktree: async () => ({ path: worktreePath, branch: `feat/${SLUG}` }),
      prepareWorktree: async () => {
        if (opts.prepareError) throw opts.prepareError;
      },
      runSetupTriage: async () => {
        record.triageCalls += 1;
        return opts.triage ?? {
          kind: 'park',
          outputTail: 'project setup (bin/setup) failed: exit 1',
        };
      },
      runConductor: async () => {
        record.conductorCalls += 1;
      },
      readOutcome: async () => opts.outcome ?? {
        done: false,
        halted: false,
        reason: 'loop ended without DONE or HALT marker',
      },
      teardownWorktree: async (_worktree, keep) => {
        record.teardownKeeps.push(keep);
      },
      markProcessed: async () => {},
      daemon: true,
      project: 'acceptance-project',
      projectRoot,
      log: (message) => record.logs.push(message),
      sweepMergeableLabels: async () => {},
      escalateBuildFailure: async ({ failureReason }) => {
        record.escalations.push(failureReason);
        return {};
      },
    };
  }

  async function runTriagePark(reason: string, record = freshRecord()) {
    const run = makeRunFeature(depsFor({
      record,
      prepareError: new SetupFailureError('setup failed', reason),
      triage: {
        kind: 'park',
        outputTail: reason,
        contractOutcome: 'setup-still-failing',
        preservedPaths: ['tmp/setup-debug.log'],
      },
    }));
    return { result: await run(ITEM), record };
  }

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'automatic-park-acceptance-'));
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'acceptance@example.com']);
    await git(['config', 'user.name', 'Acceptance Test']);
    await git(['config', 'commit.gpgsign', 'false']);
    await writeMergedSpec();
    await mkdir(join(projectRoot, '.worktrees'), { recursive: true });
    worktreePath = join(projectRoot, '.worktrees', SLUG);
    await git(['worktree', 'add', '-q', '-b', `feat/${SLUG}`, worktreePath, 'main']);
    await writeFile(join(worktreePath, 'feature-branch.txt'), 'unmerged feature work\n');
    await git(['add', 'feature-branch.txt'], worktreePath);
    await git(['commit', '-q', '-m', 'feature branch fixture'], worktreePath);
  });

  afterEach(async () => {
    await chmod(join(projectRoot, '.daemon', 'parked'), 0o755).catch(() => {});
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('triage park writes the main-root marker before an honest HALT, and every next-scan consumer holds the feature', async () => {
    expect(await discoverSlugs()).toContain(SLUG);

    const { result, record } = await runTriagePark(
      'project setup (bin/setup) failed: exit 1',
    );

    expect(result.status).toBe('error');
    expect(record.teardownKeeps).toEqual([true]);
    expect(record.triageCalls).toBe(1);
    expect(record.conductorCalls).toBe(0);

    const marker = await readFile(markerPath(), 'utf8');
    expect(marker).toMatch(/^auto-parked: project setup \(bin\/setup\) failed: exit 1\n/);
    expect(marker).toMatch(/\ntimestamp: \d{4}-\d{2}-\d{2}T/);
    expect(await exists(join(worktreePath, '.daemon', 'parked', SLUG))).toBe(false);

    const halt = await readFile(haltPath(), 'utf8');
    expect(halt).toMatch(/^feature parked — will not re-dispatch on the next scan/i);
    expect(halt).toMatch(/will not re-dispatch/i);
    expect(halt).toContain('project setup (bin/setup) failed: exit 1');
    expect(halt).toContain('No quarantine ref exists');
    expect(halt).toContain('Contract outcome: setup-still-failing');
    expect(halt).toContain('tmp/setup-debug.log');
    expect(halt).toContain('Resume procedure:');
    expect(halt).toContain('2. rm .pipeline/HALT');
    expect(halt).toContain(`3. conduct-ts daemon unpark ${SLUG}`);
    expect(await readFile(haltClassPath(), 'utf8')).toBe('needs-human');

    expect(await discoverSlugs()).not.toContain(SLUG);
    expect(await getProvenanceType(projectRoot, SLUG)).toBe('auto');

    const reconciliation = await reconcileParkedFeatures({
      projectRoot,
      // The production adapter is correctly blocked in ordinary Vitest runs;
      // keep this acceptance path on its real local-Git fixture boundary.
      runGit: async (args, { cwd }) => ({ stdout: await git(args, cwd) }),
      autoCleanup: false,
      getIssueState: async () => 'OPEN',
    });
    expect(reconciliation.counts.parked).toBe(1);

    // Worktree-local HALT loss and daemon in-memory restart do not affect the
    // next discovery pass: the main-root marker remains the authority.
    await rm(haltPath(), { force: true });
    await rm(haltClassPath(), { force: true });
    expect(await discoverSlugs()).not.toContain(SLUG);
    expect(record.triageCalls).toBe(1);
  });

  it('a durable park write failure is reported in HALT and logs while the runner returns normally', async () => {
    const parkedDir = join(projectRoot, '.daemon', 'parked');
    await mkdir(parkedDir, { recursive: true });
    await chmod(parkedDir, 0o555);

    const { result, record } = await runTriagePark('setup still broken');

    expect(result.status).toBe('error');
    expect(await exists(markerPath())).toBe(false);
    const halt = await readFile(haltPath(), 'utf8');
    expect(halt).toMatch(/^feature errored — automatic park failed/i);
    expect(halt).toMatch(/EACCES|permission denied/i);
    expect(halt).toContain(`conduct-ts daemon park ${SLUG}`);
    expect(halt).not.toContain('parked for human inspection');
    expect(record.logs.some((line) =>
      line.includes(SLUG) && /park.*write.*fail/i.test(line),
    )).toBe(true);

    await chmod(parkedDir, 0o755);
    expect(await discoverSlugs()).toContain(SLUG);
  });

  it.each([
    { site: 'loop ended without DONE or HALT', mode: 'no-marker', status: 'error' },
    { site: 'catch-all thrown error', mode: 'throw', status: 'error' },
    { site: 'false-ship guard', mode: 'false-ship', status: 'halted' },
  ] as const)('$site remains unparked and truthfully says it will re-dispatch', async ({ mode, status }) => {
    const record = freshRecord();
    const opts = mode === 'throw'
      ? { record, prepareError: new Error('unexpected setup crash') }
      : mode === 'false-ship'
        ? {
            record,
            outcome: {
              done: true,
              halted: false,
              finishChoice: undefined,
              prUrl: undefined,
            } satisfies WorktreeOutcome,
          }
        : {
            record,
            outcome: {
              done: false,
              halted: false,
              reason: 'loop ended without DONE or HALT marker',
            } satisfies WorktreeOutcome,
          };

    const result = await makeRunFeature(depsFor(opts))(ITEM);

    expect(result.status).toBe(status);
    expect(await exists(markerPath())).toBe(false);
    expect(await readFile(haltClassPath(), 'utf8')).toBe('needs-human');
    const halt = await readFile(haltPath(), 'utf8');
    expect(halt).toMatch(/^feature errored — will re-dispatch on the next scan/i);
    expect(halt).not.toContain('parked for human inspection');
    expect(halt).toContain('2. rm .pipeline/HALT');
    expect(halt).toContain('3. Re-queue the feature (restart the daemon if it was excluded this run).');
    expect(halt).not.toContain(`conduct-ts daemon unpark ${SLUG}`);
    expect(await discoverSlugs()).toContain(SLUG);
    expect(record.escalations).toHaveLength(mode === 'false-ship' ? 1 : 0);
  });

  it('operator unpark permits one new fix-session, whose second failure writes a fresh reason', async () => {
    const record = freshRecord();
    await runTriagePark('first unresolved setup failure', record);
    const firstMarker = await readFile(markerPath(), 'utf8');
    expect(firstMarker).toContain('first unresolved setup failure');
    expect(await discoverSlugs()).not.toContain(SLUG);

    await removeOperatorPark(projectRoot, SLUG);
    await rm(haltPath(), { force: true });
    await rm(haltClassPath(), { force: true });
    expect(await discoverSlugs()).toContain(SLUG);

    await runTriagePark('second different setup failure', record);
    const secondMarker = await readFile(markerPath(), 'utf8');
    expect(secondMarker).toContain('second different setup failure');
    expect(secondMarker).not.toContain('first unresolved setup failure');
    expect(record.triageCalls).toBe(2);
    expect(await discoverSlugs()).not.toContain(SLUG);
  });
});

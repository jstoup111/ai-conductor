// Covers: task:27
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Every Git argv is recorded and still executed for real, so each site's
// legacy `git commit` argv and the guarded helper's plumbing are both visible.
const gitCalls = vi.hoisted(() => [] as { args: readonly string[]; cwd?: string }[]);
vi.mock('execa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('execa')>();
  const recordingExeca = ((file: string, args?: readonly string[], options?: { cwd?: string }) => {
    if (file === 'git' && Array.isArray(args)) gitCalls.push({ args: [...args], cwd: options?.cwd });
    return (actual.execa as (...input: unknown[]) => unknown)(file, args, options);
  }) as unknown as typeof actual.execa;
  return { ...actual, execa: recordingExeca };
});

// FINISH publication reaches its shipped-record findings commit only through
// the publication state machine. These seams stop at that effect: the intent
// policy and draft-PR provenance are GitHub-facing, and the typed PRD-audit
// verdict supplies one recorded finding so the commit has content.
const prdAuditOverride = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock('../../src/engine/prd-audit-verdict-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/prd-audit-verdict-store.js')>();
  return {
    ...actual,
    readPrdAuditVerdict: async (...args: Parameters<typeof actual.readPrdAuditVerdict>) =>
      prdAuditOverride.value === undefined
        ? actual.readPrdAuditVerdict(...args)
        : { kind: 'present', value: prdAuditOverride.value },
  };
});
vi.mock('../../src/engine/finish-publication.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/finish-publication.js')>();
  return {
    ...actual,
    resolveUnattendedPublicationIntent: () => ({ authority: { kind: 'unattended_policy', mode: 'daemon' }, outcome: 'pr' }),
    advanceFinishPublication: async (input: { effects: { createShippedRecord?: () => Promise<void> } }) => {
      await input.effects.createShippedRecord?.();
      throw new Error('sweep: shipped record effect completed');
    },
  };
});
vi.mock('../../src/engine/ship-draft-pr.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/ship-draft-pr.js')>();
  return { ...actual, createShipDraftPublicationDependencies: async () => undefined };
});

const { execa } = await import('execa');
const { recordHalt, supersedeHaltRecord } = await import('../../src/engine/halt-record.js');
const { quarantine, fixSession } = await import('../../src/engine/setup-triage.js');
const { dispatchShippedRecord } = await import('../../src/engine/shipped-record-cli.js');
const { makeProductionRepairPublisher } = await import('../../src/engine/shipment-evidence-cli.js');
const { createProductionFinishPublicationCoordinator } = await import('../../src/engine/finish-publication-production.js');
const { Conductor } = await import('../../src/engine/conductor.js');
const { ALL_STEPS } = await import('../../src/engine/steps.js');
const { ConductorEventEmitter } = await import('../../src/ui/events.js');
const { PREPARE_COMMIT_MSG_HOOK } = await import('../../src/engine/git-hook-assets.js');
const { createRestackJournal, journalRefFor, writeRestackJournalBlob } = await import('../../src/engine/restack/restack-journal.js');
const { persistFixtureTestRemediationPlan } = await import('./remediation-plan-fixtures.js');
import type { HaltRecordInput } from '../../src/engine/halt-record.js';
import type { GitRunner as TriageGitRunner } from '../../src/engine/setup-triage.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import type { ConductState } from '../../src/types/index.js';
import type { RestackJournalDraft } from '../../src/engine/restack/restack-journal.js';
import type { RestackOpId } from '../../src/engine/restack/restack-types.js';
import type { ChildId } from '../../src/engine/child-context.js';

const roots: string[] = [];

beforeEach(() => {
  gitCalls.length = 0;
  prdAuditOverride.value = undefined;
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execa('git', args, { cwd })).stdout.trim();
}

interface Fixture { readonly root: string; readonly primary: string; readonly worktree: string }

/**
 * A primary checkout, a bare `origin`, and a linked feature worktree. A durable
 * stacked feature sits on `feat/c1/demo`; the flat comparison sits on a child
 * branch of a different feature, so `demo` has no durable child state and no
 * site tries to publish from a non-child branch.
 */
async function featureRepo(durable: boolean): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'engine-commit-sites-sweep-'));
  roots.push(root);
  const primary = join(root, 'primary');
  const worktree = join(root, 'demo');
  await mkdir(join(primary, '.docs', 'plans'), { recursive: true });
  await git(primary, ['init', '-q', '-b', 'main']);
  await git(primary, ['config', 'user.email', 'sites@example.invalid']);
  await git(primary, ['config', 'user.name', 'Commit sites sweep']);
  await git(primary, ['config', 'commit.gpgSign', 'false']);
  await writeFile(join(primary, 'README.md'), 'base\n');
  await writeFile(join(primary, '.docs', 'plans', 'demo.md'), '# Demo plan\n');
  await writeFile(join(primary, '.docs', 'plans', 'feature.md'), '# Implementation plan\n');
  await git(primary, ['add', '.']);
  await git(primary, ['commit', '-qm', 'base']);
  await git(root, ['clone', '-q', '--bare', primary, join(root, 'origin.git')]);
  await git(primary, ['remote', 'add', 'origin', join(root, 'origin.git')]);
  await git(primary, ['fetch', '-q', 'origin']);
  await git(primary, ['worktree', 'add', '-q', '-b', durable ? 'feat/c1/demo' : 'feat/c1/other', worktree]);
  return { root, primary, worktree };
}

async function fenceJournal(worktree: string, state: 'ready' | 'moved' | 'rolling-back'): Promise<void> {
  await git(worktree, ['update-ref', '-d', journalRefFor('demo')]);
  const draft: RestackJournalDraft = {
    opId: `sites-sweep-${state}` as RestackOpId,
    cause: 'feature-repair',
    committer: { name: 'Sweep', email: 'sweep@example.invalid', date: '2030-01-01T00:00:00Z' },
    dirtyPaths: [], refs: [], ranges: [], children: [],
  };
  const created = await createRestackJournal(worktree, 'demo', draft);
  if (created.kind !== 'created') throw new Error('journal was not created');
  const fenced = await writeRestackJournalBlob(worktree, { ...created.journal.journal, state });
  await git(worktree, ['update-ref', journalRefFor('demo'), fenced, created.journal.blob]);
}

function haltInput(): HaltRecordInput {
  return {
    slug: 'demo', haltClass: 'needs-human', step: 'build', phase: 'BUILD', branch: 'feat/c1/demo',
    headSha: 'a'.repeat(40), haltedAt: '2030-01-01T00:00:00.000Z', haltBody: 'halt', child: 1 as ChildId,
  };
}

function triageGit(cwd: string): TriageGitRunner {
  return async (args) => {
    const result = await execa('git', args, { cwd, reject: false });
    return { exitCode: result.exitCode ?? 1, stdout: String(result.stdout), stderr: String(result.stderr) };
  };
}

function commitArgv(): readonly (readonly string[])[] {
  return gitCalls.filter((call) => call.args[0] === 'commit').map((call) => call.args);
}

function headMoves(): readonly { readonly args: readonly string[]; readonly cwd?: string }[] {
  return gitCalls.filter((call) => call.args[0] === 'update-ref' && call.args[1] === 'HEAD');
}

const PR_URL = 'https://github.com/acme/rocket/pull/1';
const REPAIR_BRANCH = 'shipment-repair/1/demo';

interface CommitSite {
  readonly name: string;
  /** Today's `git commit` argv for a feature without durable child state. */
  readonly todayArgv: (fixture: Fixture) => readonly (readonly string[])[];
  /** Drive the site once; it may report failure but must not throw unexpectedly. */
  readonly run: (fixture: Fixture) => Promise<void>;
}

const SITES: readonly CommitSite[] = [
  {
    name: 'halt-record (recordHalt and supersedeHaltRecord)',
    todayArgv: () => [
      ['commit', '--no-verify', '-m', 'halt record: demo'],
      ['commit', '--no-verify', '-m', 'halt record resolved: demo'],
    ],
    run: async ({ worktree }) => {
      await recordHalt(worktree, haltInput());
      await supersedeHaltRecord(worktree, 'demo', 'fixed');
    },
  },
  {
    name: 'conductor plan amendment',
    todayArgv: ({ worktree }) => [[
      'commit', '-m', 'chore(plan): record appended remediation tasks', '--no-verify', '--',
      join(worktree, '.docs/plans/feature.md'),
    ]],
    run: async ({ worktree }) => {
      await mkdir(join(worktree, '.pipeline'), { recursive: true });
      await writeFile(join(worktree, '.pipeline/engine-state.json'), JSON.stringify({
        activePlanPath: join(worktree, '.docs/plans/feature.md'),
      }));
      const runner: StepRunner = {
        run: async (_step, _state, options) => {
          await persistFixtureTestRemediationPlan(worktree, options, [{
            id: 'sites-sweep-gap', disposition: 'build', category: null,
            rationale: 'The sweep needs one appended remediation task.',
            tasks: [{ id: 'rem-sites-sweep-1', title: 'Append one remediation task' }],
          }]);
          return { success: true };
        },
      };
      const conductor = new Conductor({
        stateFilePath: join(worktree, '.pipeline/conduct-state.json'),
        stepRunner: runner,
        events: new ConductorEventEmitter(),
        projectRoot: worktree,
        featureSlug: 'demo',
        mode: 'auto',
        daemon: true,
        verifyArtifacts: false,
        maxRetries: 1,
      });
      await (conductor as unknown as {
        planRemediation: (
          state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string,
          hintSource: { source: string; evidenceFile: string },
        ) => Promise<unknown>;
      }).planRemediation(
        { session_started_at: Date.now() - 1_000, feature_desc: 'demo' } as ConductState,
        ALL_STEPS,
        'build review blocked',
        { source: 'build-review', evidenceFile: '.pipeline/build-review.json' },
      );
      expect(await readFile(join(worktree, '.docs/plans/feature.md'), 'utf8')).toContain('rem-sites-sweep-1');
    },
  },
  {
    name: 'setup-triage quarantine',
    todayArgv: () => [['commit', '-m', 'Quarantine before reset']],
    run: async ({ worktree }) => {
      await writeFile(join(worktree, 'quarantined.txt'), 'residue\n');
      await quarantine(triageGit(worktree), 'demo', undefined, worktree);
    },
  },
  {
    name: 'setup-triage rejected-repair preservation',
    todayArgv: () => [['commit', '-m', 'wip(setup): preserve rejected repair']],
    run: async ({ worktree }) => {
      await fixSession(triageGit(worktree), worktree, 'demo', async () => {
        await writeFile(join(worktree, 'rejected.txt'), 'rejected repair\n');
      }, async () => {
        throw new Error('setup still failing');
      });
    },
  },
  {
    name: 'setup-triage retained repair',
    todayArgv: () => [['commit', '-m', 'fix(setup): retain verified repair']],
    run: async ({ worktree }) => {
      await fixSession(triageGit(worktree), worktree, 'demo', async () => {
        await writeFile(join(worktree, 'repaired.txt'), 'verified repair\n');
      }, async () => undefined);
    },
  },
  {
    name: 'finish-publication shipped-record findings',
    todayArgv: () => [['commit', '-m', 'shipped record findings: demo', '--no-verify']],
    run: async ({ worktree }) => {
      await mkdir(join(worktree, '.pipeline'), { recursive: true });
      prdAuditOverride.value = {
        attemptId: 'sites-sweep', codeStamp: null, complete: true, diagnostics: [],
        judgment: {
          version: 'v1',
          criterionJudgments: [{
            criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade: 'OVER_SCOPE',
            evidence: 'src/unplanned.ts:1', rationale: 'Recorded for the shipped record.',
            requirementAssociations: [], evidenceTaskIds: [], intentRelation: 'within',
          }],
          noOwnerObservations: [],
        },
        recordedDispositions: [{
          criterionId: 'S1.1', grade: 'OVER_SCOPE', decision: 'refuse',
          rationale: 'Requires a plan decision.', authority: 'operator@example.test',
        }],
      };
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: worktree,
        stateFilePath: join(worktree, '.pipeline/conduct-state.json'),
        baseBranch: 'main',
        git: async (args, opts) => ({ stdout: (await execa('git', args, { cwd: opts.cwd, reject: false })).stdout }),
        gh: async () => {
          throw new Error('sweep: no GitHub');
        },
        writeShippedRecord: async () => {
          await mkdir(join(worktree, '.docs', 'shipped'), { recursive: true });
          await writeFile(join(worktree, '.docs/shipped/demo.md'), `---\nslug: demo\nspec_hash: abc\npr: ${PR_URL}\n---\n`);
          return 0;
        },
      });
      const outcome = await coordinator.advance({
        state: { feature_desc: 'demo', pr_url: PR_URL, worktree_branch: 'feat/c1/demo' } as ConductState,
        mode: 'auto',
        daemon: true,
        dispatchJudgment: async () => ({ success: true }),
        emit: async () => undefined,
      }).then(() => undefined, (error: unknown) => error);
      // Reaching the sentinel proves the effect ran to its commit decision;
      // a guarded refusal surfaces as the site's own error instead.
      expect(outcome).toBeInstanceOf(Error);
    },
  },
  {
    name: 'shipped-record-cli shipped record',
    todayArgv: () => [['commit', '-m', 'shipped record: demo', '--no-verify']],
    run: async ({ worktree }) => {
      await dispatchShippedRecord({ kind: 'write', slug: 'demo', pr: 'local' }, worktree);
    },
  },
  {
    name: 'shipment-evidence-cli shipped-record repair',
    todayArgv: () => [['commit', '-m', `docs: repair shipped record for ${REPAIR_BRANCH}`]],
    run: async ({ worktree }) => {
      const publisher = makeProductionRepairPublisher({
        cwd: worktree,
        implementationPr: PR_URL,
        slug: 'demo',
        runGh: async () => {
          throw new Error('sweep: no remote repair branch');
        },
        runGit: async (args, opts) => {
          const result = await execa('git', args, { cwd: opts?.cwd ?? worktree, reject: false });
          if (result.exitCode !== 0) throw new Error(String(result.stderr));
          return { stdout: String(result.stdout) };
        },
        evaluateEvidence: async () => {
          throw new Error('sweep: not evaluated');
        },
        repo: 'acme/rocket',
        remoteGit: (async () => ({ kind: 'executed', targets: [] })) as never,
      });
      await publisher.ensureRepairBranch({ branch: REPAIR_BRANCH, base: 'main' });
      await publisher.commitRecordOnly({
        branch: REPAIR_BRANCH,
        writes: [{ path: '.docs/shipped/demo.md', content: `---\nslug: demo\nspec_hash: abc\npr: ${PR_URL}\nshipped: 2030-01-01\n---\n` }],
      }).catch(() => undefined);
    },
  },
];

describe('engine commit sites sweep (real local Git)', () => {
  // Covers: task:27
  it("recordHalt in a stacked worktree commits only its record through the guard with today's co-author and Task trailers, a verifiable signature and only prepare-commit-msg", async () => {
    const trailersBySite: Record<'stacked' | 'flat', string> = { stacked: '', flat: '' };
    for (const shape of ['stacked', 'flat'] as const) {
      const { root, worktree } = await featureRepo(shape === 'stacked');
      // Real engine prepare-commit-msg (co-author + Task: stamping), wrapped with a run log.
      const hooks = join(root, 'hooks');
      const log = join(root, 'hooks.log');
      await mkdir(hooks, { recursive: true });
      const [shebang, ...body] = PREPARE_COMMIT_MSG_HOOK.split('\n');
      await writeFile(join(hooks, 'prepare-commit-msg'), [shebang, `echo prepare-commit-msg >> '${log}'`, ...body].join('\n'));
      for (const name of ['pre-commit', 'commit-msg']) {
        await writeFile(join(hooks, name), `#!/bin/sh\necho ${name} >> '${log}'\nexit 0\n`);
        await chmod(join(hooks, name), 0o755);
      }
      await chmod(join(hooks, 'prepare-commit-msg'), 0o755);
      await git(worktree, ['config', 'core.hooksPath', hooks]);
      // SSH commit signing, verifiable locally.
      const key = join(root, 'signing-key');
      await execa('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'sweep', '-f', key]);
      await writeFile(join(root, 'allowed-signers'), `sites@example.invalid ${(await readFile(`${key}.pub`, 'utf8')).trim()}\n`);
      await git(worktree, ['config', 'gpg.format', 'ssh']);
      await git(worktree, ['config', 'user.signingkey', key]);
      await git(worktree, ['config', 'gpg.ssh.allowedSignersFile', join(root, 'allowed-signers')]);
      await git(worktree, ['config', 'commit.gpgSign', 'true']);
      await mkdir(join(worktree, '.pipeline'), { recursive: true });
      await writeFile(join(worktree, '.pipeline', 'co-author'), 'Co-authored-by: sweep-bot <1+sweep-bot@users.noreply.github.com>\n');
      await writeFile(join(worktree, '.pipeline', 'current-task'), '27\n');
      await writeFile(join(worktree, 'stray.txt'), 'unrelated\n');
      const before = await git(worktree, ['rev-parse', 'HEAD']);
      gitCalls.length = 0;

      await expect(recordHalt(worktree, haltInput())).resolves.toEqual({ kind: 'written' });

      const head = await git(worktree, ['rev-parse', 'HEAD']);
      expect(await git(worktree, ['rev-parse', 'HEAD^'])).toBe(before);
      expect(await git(worktree, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])).toBe('.docs/halted/demo.md');
      await expect(execa('git', ['verify-commit', head], { cwd: worktree })).resolves.toMatchObject({ exitCode: 0 });
      expect((await readFile(log, 'utf8')).split('\n').filter(Boolean)).toEqual(['prepare-commit-msg']);
      trailersBySite[shape] = await git(worktree, ['log', '-1', '--format=%(trailers:only,unfold)']);
      if (shape === 'stacked') {
        // The stacked path is the guarded helper, never a `git commit`.
        expect(commitArgv()).toEqual([]);
        expect(gitCalls.some((call) => call.args[0] === 'commit-tree')).toBe(true);
      } else {
        expect(commitArgv()).toEqual([['commit', '--no-verify', '-m', 'halt record: demo']]);
      }
    }
    expect(trailersBySite.stacked).toContain('Co-authored-by: sweep-bot <1+sweep-bot@users.noreply.github.com>');
    expect(trailersBySite.stacked).toContain('Task: 27');
    expect(trailersBySite.stacked).toBe(trailersBySite.flat);
  });

  // Covers: task:27
  it("commits exactly a setup-triage retained repair's captured paths and a superseded halt record while unrelated staged changes stay staged", async () => {
    const { worktree } = await featureRepo(true);
    const before = await git(worktree, ['rev-parse', 'HEAD']);
    gitCalls.length = 0;

    const outcome = await fixSession(triageGit(worktree), worktree, 'demo', async () => {
      await writeFile(join(worktree, 'a.txt'), 'a\n');
      await mkdir(join(worktree, 'b'), { recursive: true });
      await writeFile(join(worktree, 'b', 'c.txt'), 'c\n');
    }, async () => undefined);

    expect(outcome).toMatchObject({ kind: 'fixed-pass', contractOutcome: 'engine-committed' });
    expect(commitArgv()).toEqual([]);
    expect(await git(worktree, ['rev-parse', 'HEAD^'])).toBe(before);
    expect((await git(worktree, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])).split('\n').sort()).toEqual(['a.txt', 'b/c.txt']);

    await expect(recordHalt(worktree, haltInput())).resolves.toEqual({ kind: 'written' });
    await writeFile(join(worktree, 'staged-elsewhere.txt'), 'unrelated staged\n');
    await git(worktree, ['add', 'staged-elsewhere.txt']);
    const recorded = await git(worktree, ['rev-parse', 'HEAD']);

    await expect(supersedeHaltRecord(worktree, 'demo', 'fixed')).resolves.toEqual({ kind: 'written' });

    expect(await git(worktree, ['rev-parse', 'HEAD^'])).toBe(recorded);
    expect(await git(worktree, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])).toBe('.docs/halted/demo.md');
    expect(await git(worktree, ['show', 'HEAD:.docs/halted/demo.md'])).toMatch(/Status: (superseded|resolved)/i);
    expect(await git(worktree, ['diff', '--cached', '--name-only'])).toBe('staged-elsewhere.txt');
    expect(await git(worktree, ['cat-file', '-e', 'HEAD:staged-elsewhere.txt']).catch(() => 'absent')).toBe('absent');
  });

  // Covers: task:27
  it.each(SITES)("$name keeps today's git commit argv without durable child state, commits through the guarded helper with it, and is refused without moving HEAD in each fenced journal state", async (site) => {
      // Flat feature: today's argv, unchanged.
      const flat = await featureRepo(false);
      gitCalls.length = 0;
      await site.run(flat);
      expect(commitArgv(), `${site.name}: flat argv`).toEqual(site.todayArgv(flat));
      expect(headMoves(), `${site.name}: flat uses no guarded update-ref`).toEqual([]);

      // Durable child state, no journal: the guarded helper writes the commit.
      const stacked = await featureRepo(true);
      gitCalls.length = 0;
      await site.run(stacked);
      expect(commitArgv(), `${site.name}: stacked issues no git commit`).toEqual([]);
      expect(headMoves().length, `${site.name}: stacked moves HEAD through the guard`).toBeGreaterThan(0);
      expect(gitCalls.some((call) => call.args[0] === 'commit-tree'), `${site.name}: stacked commit-tree`).toBe(true);

      // Fenced journal: refused, HEAD unchanged. One checkout steps through
      // every fenced state, restored to a clean tree between attempts.
      const fenced = await featureRepo(true);
      const before = await git(fenced.worktree, ['rev-parse', 'HEAD']);
      for (const state of ['ready', 'moved', 'rolling-back'] as const) {
        await git(fenced.worktree, ['reset', '-q', '--hard', before]);
        await git(fenced.worktree, ['clean', '-qfdx']);
        await fenceJournal(fenced.worktree, state);
        gitCalls.length = 0;
        await site.run(fenced);
        expect(commitArgv(), `${site.name}: ${state} issues no git commit`).toEqual([]);
        expect(headMoves(), `${site.name}: ${state} moves no HEAD`).toEqual([]);
        expect(gitCalls.some((call) => call.args[0] === 'commit-tree'), `${site.name}: ${state} builds no commit`).toBe(false);
        expect(await git(fenced.worktree, ['rev-parse', 'HEAD']), `${site.name}: ${state} HEAD`).toBe(before);
      }
  });
});

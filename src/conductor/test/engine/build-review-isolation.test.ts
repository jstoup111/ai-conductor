import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  assembleBuildReviewInputs,
  TestSuiteProofError,
  type BuildReviewFrozenInputs,
  type BuildReviewInputOptions,
} from '../../src/engine/build-review-inputs.js';
import { buildGraderPrompt } from '../../src/engine/build-review-prompt.js';
import type { GitRunner } from '../../src/engine/rebase.js';
import type { FullSuiteInspectionResult } from '../../src/engine/full-suite-verifier.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { HarnessConfig } from '../../src/types/config.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { coordinateBuildReviewRubrics } from '../../src/engine/build-review-coordinator.js';
import { MAX_MECHANICAL_FAULTS_BUILD_REVIEW, writeKickbackLedger } from '../../src/engine/kickback-ledger.js';

vi.mock('../../src/engine/build-review-coordinator.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/build-review-coordinator.js')>(),
  coordinateBuildReviewRubrics: vi.fn(),
}));

// ── Structural input-isolation test (build_review) ───────────────────────
//
// The build_review grader must see ONLY the diff + plan body — never the
// maker's `.pipeline/task-status.json` or any transcript. This is enforced
// two ways:
//   1. Structurally: assembleBuildReviewInputs(git, planPath) and
//      buildGraderPrompt(inputs) have signatures that admit no state/summary
//      parameter at all (a compile-level guarantee — see the type-only
//      assertions below).
//   2. At runtime: seed a fixture repo whose tree contains a maker "summary"
//      sentinel in task-status.json and a transcript-like file, assemble the
//      full grader prompt from it, and assert the sentinel never appears.

const TASK_STATUS_SENTINEL = 'TASK_STATUS_SENTINEL_12345';
const TRANSCRIPT_SENTINEL = 'TRANSCRIPT_SENTINEL_12345';
const MAKER_SUMMARY_SENTINEL = 'MAKER_SUMMARY_SENTINEL_12345';
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const BROAD_FALLBACK_TRIGGERS = [
  'A shared/core module has 3+ production importers.',
  'The diff touches config, migrations, dependency manifests, or test infrastructure.',
  'The scoped/affected set is empty.',
  'Module-to-test mapping is low-confidence and cannot be made confidently.',
] as const;

const execFileAsync = promisify(execFile);
const CURRENT_PROOF = {
  status: 'CURRENT',
  evidence: { provenanceHeadSha: 'isolation-head', outcome: 'PASS' },
} as FullSuiteInspectionResult;

describe('build_review input isolation', () => {
  let dir: string;
  let mainDir: string;
  let planPath: string;

  async function git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', dir, ...args]);
    return stdout.trim();
  }

  function realGit(): GitRunner {
    return async (args: string[]) => {
      try {
        const { stdout, stderr } = await execFileAsync('git', ['-C', dir, ...args]);
        return { exitCode: 0, stdout, stderr };
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string };
        return { exitCode: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
      }
    };
  }

  beforeEach(async () => {
    mainDir = await mkdtemp(join(tmpdir(), 'build-review-isolation-main-'));
    const mainGit = async (...args: string[]) => {
      await execFileAsync('git', ['-C', mainDir, ...args]);
    };
    await execFileAsync('git', ['init', '-b', 'main', mainDir]);
    await mainGit('config', 'user.email', 'test@example.com');
    await mainGit('config', 'user.name', 'Test');
    await mainGit('config', 'commit.gpgsign', 'false');
    await writeFile(join(mainDir, 'base.txt'), 'base\n');
    await mainGit('add', '.');
    await mainGit('commit', '-m', 'initial commit on base');
    await mainGit('remote', 'add', 'origin', mainDir);
    await mainGit('update-ref', 'refs/remotes/origin/main', 'refs/heads/main');
    await mainGit('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');

    dir = join(mainDir, '.worktrees', 'feature');
    await mainGit('worktree', 'add', '-b', 'feature/foo', dir);
    planPath = join(dir, 'plan.md');
    await writeFile(planPath, '# Plan body\n\nDo the isolated thing.\n', 'utf-8');

    // Commit an unrelated feature change — this is what should actually
    // appear in the graded diff.
    await writeFile(join(dir, 'feature.txt'), 'feature change\n');
    await git('add', 'feature.txt');
    await git('commit', '-m', 'add feature change');

    // Seed maker-internal-state fixtures (task-status.json + a
    // transcript-like file) on disk in the same working tree, but leave
    // them untracked/uncommitted — exactly like `.pipeline/` in the real
    // repo (see .gitignore), which holds maker state that must never reach
    // the grader. assembleBuildReviewInputs must not read these directly,
    // and they must not show up via `git diff` either, so this proves the
    // full pipeline (diff assembly -> prompt assembly) never surfaces them.
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline', 'task-status.json'),
      JSON.stringify({ status: TASK_STATUS_SENTINEL, summary: MAKER_SUMMARY_SENTINEL }, null, 2),
    );
    await writeFile(
      join(dir, 'transcript.log'),
      `maker session transcript\n${TRANSCRIPT_SENTINEL}\nsome narrative about the work\n`,
    );
  });

  afterEach(async () => {
    await rm(mainDir, { recursive: true, force: true });
  });

  it('never leaks task status, transcript, or maker-summary content into assembled inputs or the grader prompt', async () => {
    const inputs = await assembleBuildReviewInputs(realGit(), planPath, {
      inspectTestSuite: async () => CURRENT_PROOF,
    });
    const prompt = buildGraderPrompt(inputs);

    // Sanity check: the sentinel-bearing files are real, on disk, in the
    // same working tree the diff was computed from — this test would only
    // pass trivially (not meaningfully) if they didn't actually exist.
    expect(inputs.diff).toContain('feature.txt');
    expect(inputs.diff).not.toContain('task-status.json');
    expect(inputs.diff).not.toContain('transcript.log');

    const assembledContent = JSON.stringify({ inputs, prompt });
    for (const sentinel of [
      TASK_STATUS_SENTINEL,
      TRANSCRIPT_SENTINEL,
      MAKER_SUMMARY_SENTINEL,
    ]) {
      expect(assembledContent).not.toContain(sentinel);
    }

    await expect(assembleBuildReviewInputs(realGit(), planPath, {
      inspectTestSuite: async () => ({ status: 'MISSING' } as never),
    })).rejects.toBeInstanceOf(TestSuiteProofError);
  });

  it('admits only git, plan, and proof inspection / inputs at the type level — no state parameter exists', () => {
    // Compile-level check: these assignments only type-check if the
    // functions' parameter lists are exactly as narrow as documented. If a
    // future maintainer adds a `state`/`summary` parameter, this file fails
    // to compile (tsc), not just fails at runtime.
    type Equal<Left, Right> =
      (<T>() => T extends Left ? 1 : 2) extends (<T>() => T extends Right ? 1 : 2) ? true : false;
    type Expect<Value extends true> = Value;
    type PromptParams = Parameters<typeof buildGraderPrompt>;

    // Exact equality makes a merge-base-era `(git, planPath)` signature fail
    // the typecheck: proof inspection is now a required supported seam.
    type _AssembleSignature = Expect<Equal<
      typeof assembleBuildReviewInputs,
      (git: GitRunner, planPath: string, options?: BuildReviewInputOptions) => Promise<BuildReviewFrozenInputs>
    >>;
    const promptArity: PromptParams extends [unknown] ? true : false = true;

    const assembleSignature: _AssembleSignature = true;
    expect(assembleSignature).toBe(true);
    expect(promptArity).toBe(true);
  });

  it('keeps scoped verification agent-owned and preserves the broad-fallback contract', async () => {
    const [pipeline, tdd, harness] = await Promise.all([
      readFile(join(REPOSITORY_ROOT, 'skills/pipeline/SKILL.md'), 'utf8'),
      readFile(join(REPOSITORY_ROOT, 'skills/tdd/SKILL.md'), 'utf8'),
      readFile(join(REPOSITORY_ROOT, 'HARNESS.md'), 'utf8'),
    ]);

    for (const policy of [pipeline, tdd, harness]) {
      expect(policy).toContain('conduct-ts scoped-run <selectors...>');
      expect(policy).toMatch(/agent derives the selectors/i);
    }

    for (const trigger of BROAD_FALLBACK_TRIGGERS) {
      expect(harness).toContain(trigger);
      expect(pipeline).toContain(trigger);
    }
  });

  it('routes an infrastructure result with arbitrary detail through the mechanical lane', async () => {
    const provider: LLMProvider = {
      invoke: vi.fn(),
      invokeInteractive: vi.fn(),
    };
    const coordinate = vi.mocked(coordinateBuildReviewRubrics);
    coordinate.mockResolvedValue({
      kind: 'ready',
      branches: [
        {
          kind: 'infrastructure-failure', rubric: 'testQuality', reason: 'invalid-provider-result',
          detail: 'the test-quality worker lost its response payload',
        },
      ],
    });
    const runner = new DefaultStepRunner(provider, 'build-review-isolation', dir, {
      gitRunner: realGit(), planPath,
      config: { build_review: { enabled: true, rubrics: { testQuality: { enabled: true } } } } as HarnessConfig,
      buildReviewInputOptions: { inspectTestSuite: async () => CURRENT_PROOF },
      buildReviewArtifactReader: async (_projectRoot, rubric, lapId, snapshotDigest) => ({
        version: 1,
        rubric,
        lapId,
        snapshotDigest,
        result: {
          kind: 'judged', rubric, lapId, snapshotDigest,
          contractVersion: 'v3' as never, findings: [], verdict: 'PASS',
        },
        provenance: { kind: 'fresh' },
      }),
    });

    await expect(runner.run('build_review', {} as never)).resolves.toMatchObject({
      success: false,
      output: 'build_review mechanical fault in testQuality (malformed-artifact): invalid-provider-result: the test-quality worker lost its response payload',
      currentLapMechanicalFault: true,
    });
    await expect(readFile(join(dir, '.pipeline', 'kickback-ledger.json'), 'utf8')).resolves.toContain('"mechanicalFaults": 1');
  });

  it('keeps a judged finding with environment-sounding prose in the blocking finding lane', async () => {
    const provider: LLMProvider = { invoke: vi.fn(), invokeInteractive: vi.fn() };
    vi.mocked(coordinateBuildReviewRubrics).mockResolvedValue({
      kind: 'ready',
      branches: [{ kind: 'dispatched' as const, rubric: 'testQuality', result: {} as never }],
    });
    const runner = new DefaultStepRunner(provider, 'build-review-isolation', dir, {
      gitRunner: realGit(), planPath,
      config: { build_review: { enabled: true, rubrics: { testQuality: { enabled: true } } } } as HarnessConfig,
      buildReviewInputOptions: { inspectTestSuite: async () => CURRENT_PROOF },
      buildReviewArtifactReader: async (_projectRoot, rubric, lapId, snapshotDigest) => ({
        version: 1,
        rubric,
        lapId,
        snapshotDigest,
        result: {
          kind: 'judged', rubric, lapId, snapshotDigest,
          contractVersion: 'v3' as never,
          findings: [{
            concernKind: 'test-insensitive',
            summary: 'The environment cannot load this change safely.',
            evidenceLocations: ['feature.txt:1'],
            anchor: { rubric: 'testQuality', locus: { path: 'feature.txt', contentHash: 'sha256:fixture', display: 'fixture test' } },
          }],
          verdict: 'FAIL',
        },
        provenance: { kind: 'fresh' },
      }),
    });

    const result = await runner.run('build_review', {} as never);

    // A judged finding is deliberately surfaced as a successful runner
    // dispatch: the conductor consumes the persisted FAIL aggregate and
    // routes it through the normal build-review kickback lane.
    expect(result).toMatchObject({ success: true });
    expect(result.currentLapMechanicalFault).toBeUndefined();
    expect(result.output).toContain('The environment cannot load this change safely.');
    await expect(readFile(join(dir, '.pipeline', 'build-review.json'), 'utf8')).resolves.toContain(
      'The environment cannot load this change safely.',
    );
  });

  it('publishes an exhausted malformed artifact as the current lap mechanical failure', async () => {
    const provider: LLMProvider = { invoke: vi.fn(), invokeInteractive: vi.fn() };
    vi.mocked(coordinateBuildReviewRubrics).mockResolvedValue({
      kind: 'ready',
      branches: [{ kind: 'dispatched' as const, rubric: 'testQuality', result: {} as never }],
    });
    const runner = new DefaultStepRunner(provider, 'build-review-isolation', dir, {
      gitRunner: realGit(), planPath,
      config: { build_review: { enabled: true, rubrics: { testQuality: { enabled: true } } } } as HarnessConfig,
      buildReviewInputOptions: { inspectTestSuite: async () => CURRENT_PROOF },
      buildReviewArtifactReader: async (_projectRoot, rubric, lapId, snapshotDigest) => ({
        version: 1,
        rubric,
        lapId,
        snapshotDigest,
        result: { kind: 'not-a-rubric-result' } as never,
        provenance: { kind: 'fresh' },
      }),
    });

    await writeKickbackLedger(dir, {
      version: 1,
      gates: {
        build_review: {
          count: 0, cumulative: 0, mechanicalFaults: MAX_MECHANICAL_FAULTS_BUILD_REVIEW - 1,
          treeHash: null, lastReason: '', priorVerdict: true, resolvedBefore: 0,
        },
      },
    });

    await expect(runner.run('build_review', {} as never)).resolves.toMatchObject({ success: false });
    await expect(readFile(join(dir, '.pipeline', 'build-review.json'), 'utf8')).resolves.toContain(
      '"reason": "malformed-artifact"',
    );
  });
});

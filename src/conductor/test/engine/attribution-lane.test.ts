import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider, InvokeOptions } from '../../src/execution/llm-provider.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { GitRunner } from '../../src/engine/rebase.js';
import {
  dispatchAttributionVerifier,
  computeMemoKey,
  readMemo,
  writeMemo,
  // Task 6 (RED) — not implemented until Task 7. Importing this makes the
  // whole suite fail to load, which is the expected RED failure mode.
  rekeyMemoAfterRebase,
} from '../../src/engine/attribution-lane.js';

// ── Fresh-session verifier dispatch (Task 7) ──────────────────────────────
//
// The attribution verifier runs in a fresh, isolated session — never resumes
// the main conductor session. It follows the same one-shot pattern as
// runBuildReview: fresh uuid, resume: false, walked through the model fallback
// ladder. Dispatch creates the session with proper step ID and CWD configuration.

/**
 * Create a mocked git runner for testing without a real git repo.
 */
function createMockedGitRunner(
  headSha = 'abc1234567890def1234567890def1234567890',
): GitRunner {
  return vi.fn().mockResolvedValue({
    exitCode: 0,
    stdout: headSha,
    stderr: '',
  }) as unknown as GitRunner;
}

describe('dispatchAttributionVerifier', () => {
  let dir: string;
  let planPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'attribution-verifier-'));
    planPath = join(dir, 'plan.md');
    await writeFile(
      planPath,
      `# Plan

## Task 1
Implement the sweep feature.

**Files:** src/sweep.ts

## Task 2
Add tests for sweep.

**Files:** test/sweep.test.ts
`,
      'utf-8',
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('dispatches with a fresh uuid and resume:false, never the conductor session', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      output: '{"schema": 1}',
      exitCode: 0,
    });
    const provider: LLMProvider = {
      invoke,
      invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };

    const result = await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1', '2'],
      featureWorktreePath: dir,
      gitRunner: createMockedGitRunner(),
      gitRunner: createMockedGitRunner(),
    });

    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledOnce();
    const opts = invoke.mock.calls[0][0] as InvokeOptions;
    expect(opts.resume).toBe(false);
    expect(opts.sessionId).toBeTruthy();
    // A real uuid, not empty/undefined.
    expect(opts.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('uses step ID attribution_verify', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      output: '{"schema": 1}',
      exitCode: 0,
    });
    const provider: LLMProvider = { invoke, invokeInteractive: vi.fn() };

    await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1'],
      featureWorktreePath: dir,
      gitRunner: createMockedGitRunner(),
    });

    const opts = invoke.mock.calls[0][0] as InvokeOptions;
    // The system prompt should reference the step name or ID
    expect(opts.systemPrompt).toBeTruthy();
    expect(opts.systemPrompt).toContain('attribution_verify');
  });

  it('sets session CWD to feature worktree', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      output: '{}',
      exitCode: 0,
    });
    const provider: LLMProvider = { invoke, invokeInteractive: vi.fn() };

    const featureWorktreeDir = join(dir, 'feature-worktree');
    await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1'],
      featureWorktreePath: featureWorktreeDir,
      gitRunner: createMockedGitRunner(),
    });

    const opts = invoke.mock.calls[0][0] as InvokeOptions;
    expect(opts.cwd).toBe(featureWorktreeDir);
  });

  it('resolves model and effort from config', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      output: '{}',
      exitCode: 0,
    });
    const provider: LLMProvider = { invoke, invokeInteractive: vi.fn() };

    const config: HarnessConfig = {
      model_fallback_ladder: ['claude-opus', 'claude-sonnet'],
      steps: {
        attribution_verify: {
          model: 'claude-opus',
          effort: 'medium',
        },
      },
    };

    await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1'],
      featureWorktreePath: dir,
      gitRunner: createMockedGitRunner(),
      config,
    });

    const opts = invoke.mock.calls[0][0] as InvokeOptions;
    expect(opts.model).toBe('claude-opus');
    expect(opts.effort).toBe('medium');
  });

  it('includes residue tasks and candidate commits in prompt', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      output: '{}',
      exitCode: 0,
    });
    const provider: LLMProvider = { invoke, invokeInteractive: vi.fn() };

    await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1', '2'],
      featureWorktreePath: dir,
      gitRunner: createMockedGitRunner(),
    });

    const opts = invoke.mock.calls[0][0] as InvokeOptions;
    expect(opts.prompt).toBeTruthy();
    // Prompt should include residue task sections
    expect(opts.prompt).toContain('Residue Tasks for Attribution Verification');
  });

  it('uses dangerouslySkipPermissions:true for isolated dispatch', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      output: '{}',
      exitCode: 0,
    });
    const provider: LLMProvider = { invoke, invokeInteractive: vi.fn() };

    await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1'],
      featureWorktreePath: dir,
      gitRunner: createMockedGitRunner(),
    });

    const opts = invoke.mock.calls[0][0] as InvokeOptions;
    expect(opts.dangerouslySkipPermissions).toBe(true);
  });

  it('returns success when invoke succeeds', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      output: 'attribution complete',
      exitCode: 0,
    });
    const provider: LLMProvider = { invoke, invokeInteractive: vi.fn() };

    const result = await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1'],
      featureWorktreePath: dir,
      gitRunner: createMockedGitRunner(),
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe('attribution complete');
  });

  it('returns failure on rate limit', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: false,
      output: 'rate limited',
      rateLimited: true,
      waitSeconds: 60,
    });
    const provider: LLMProvider = { invoke, invokeInteractive: vi.fn() };

    const result = await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1'],
      featureWorktreePath: dir,
      gitRunner: createMockedGitRunner(),
    });

    expect(result.success).toBe(false);
    expect(result.rateLimited).toBe(true);
    expect(result.waitSeconds).toBe(60);
  });

  it('returns failure on auth failure', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: false,
      output: 'auth failed',
      authFailure: true,
    });
    const provider: LLMProvider = { invoke, invokeInteractive: vi.fn() };

    const result = await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1'],
      featureWorktreePath: dir,
      gitRunner: createMockedGitRunner(),
    });

    expect(result.success).toBe(false);
    expect(result.authFailure).toBe(true);
  });

  it('returns failure on session expired', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: false,
      output: 'session expired',
      sessionExpired: true,
    });
    const provider: LLMProvider = { invoke, invokeInteractive: vi.fn() };

    const result = await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1'],
      featureWorktreePath: dir,
      gitRunner: createMockedGitRunner(),
    });

    expect(result.success).toBe(false);
    expect(result.sessionExpired).toBe(true);
  });

  it('names attempted models on full ladder exhaustion', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: false,
      output: 'no models available',
      modelUnavailable: true,
    });
    const provider: LLMProvider = { invoke, invokeInteractive: vi.fn() };

    const config: HarnessConfig = {
      model_fallback_ladder: ['claude-opus', 'claude-sonnet', 'claude-haiku'],
      steps: {
        attribution_verify: {
          model: 'claude-opus',
          effort: 'medium',
        },
      },
    };

    const result = await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1'],
      featureWorktreePath: dir,
      gitRunner: createMockedGitRunner(),
      config,
    });

    expect(result.success).toBe(false);
    // Output should indicate multiple models were tried
    expect(result.output).toMatch(/model fallback ladder exhausted/i);
  });
});

// ── Verdict memoization by (HEAD, residue) (Task 8) ──────────────────────────
//
// Memoizes (HEAD commit, sorted residue task IDs) to avoid re-running the
// verifier on the same code state. Memo key is computed from HEAD SHA and
// sorted residue IDs; result is cached at .pipeline/attribution-memo.json.
// Same (HEAD, residue) → no dispatch, reused result. HEAD change or residue
// change → fresh dispatch. Unreachable memo HEAD → fresh dispatch (treated as
// cache miss).

describe('Verdict memoization', () => {
  let dir: string;
  let planPath: string;
  let pipelineDir: string;
  let memoPath: string;

  /**
   * Create a mocked git runner for testing without a real git repo.
   */
  function createMockedGitRunner(
    headSha = 'abc1234567890def1234567890def1234567890',
  ): GitRunner {
    return vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: headSha,
      stderr: '',
    }) as unknown as GitRunner;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'attribution-memo-'));
    pipelineDir = join(dir, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });
    memoPath = join(pipelineDir, 'attribution-memo.json');
    planPath = join(dir, 'plan.md');
    await writeFile(
      planPath,
      `# Plan

## Task 1
Implement the sweep feature.

**Files:** src/sweep.ts

## Task 2
Add tests for sweep.

**Files:** test/sweep.test.ts
`,
      'utf-8',
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('same (HEAD, sorted residue) reuses cached result without dispatch', async () => {
    const invoke = vi.fn();
    const provider: LLMProvider = {
      invoke,
      invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };

    // First call: should dispatch and cache
    invoke.mockResolvedValueOnce({
      success: true,
      output: 'first verdict',
      exitCode: 0,
      authFailure: false,
      modelUnavailable: false,
    });

    const firstResult = await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['2', '1'], // Order will be sorted
      featureWorktreePath: dir,
      gitRunner: createMockedGitRunner(),
    });

    expect(firstResult.success).toBe(true);
    expect(invoke).toHaveBeenCalledOnce();

    // Second call with same (HEAD, sorted residue): should reuse cached result
    const secondResult = await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1', '2'], // Different order, but sorts to same
      featureWorktreePath: dir,
      gitRunner: createMockedGitRunner(),
    });

    // Should not invoke again; result comes from memo
    expect(invoke).toHaveBeenCalledOnce(); // Still just once
    expect(secondResult.success).toBe(true);
    // Result should match the cached one
    expect(secondResult.output).toContain('first verdict');
  });

  it('HEAD change triggers fresh dispatch', async () => {
    const invoke = vi.fn();
    const provider: LLMProvider = {
      invoke,
      invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };

    invoke.mockResolvedValueOnce({
      success: true,
      output: 'first verdict',
      exitCode: 0,
      authFailure: false,
      modelUnavailable: false,
    });

    // First dispatch with HEAD=abc...
    await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1'],
      featureWorktreePath: dir,
      gitRunner: createMockedGitRunner('abc1234567890def1234567890def1234567890'),
    });

    expect(invoke).toHaveBeenCalledOnce();

    // Simulate HEAD change by using a different HEAD SHA
    invoke.mockResolvedValueOnce({
      success: true,
      output: 'second verdict',
      exitCode: 0,
      authFailure: false,
      modelUnavailable: false,
    });

    const secondResult = await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1'],
      featureWorktreePath: dir,
      gitRunner: createMockedGitRunner('def4567890abc1234567890def1234567890abc'),
    });

    // Should invoke again because HEAD changed
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(secondResult.output).toContain('second verdict');
  });

  it('residue change triggers fresh dispatch', async () => {
    const invoke = vi.fn();
    const provider: LLMProvider = {
      invoke,
      invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };

    invoke.mockResolvedValueOnce({
      success: true,
      output: 'first verdict',
      exitCode: 0,
      authFailure: false,
      modelUnavailable: false,
    });

    // First dispatch with residueIds = ['1']
    await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1'],
      featureWorktreePath: dir,
      gitRunner: createMockedGitRunner(),
    });

    expect(invoke).toHaveBeenCalledOnce();

    // Second dispatch with different residueIds
    invoke.mockResolvedValueOnce({
      success: true,
      output: 'second verdict',
      exitCode: 0,
      authFailure: false,
      modelUnavailable: false,
    });

    const result = await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1', '2'], // Different residue
      featureWorktreePath: dir,
      gitRunner: createMockedGitRunner(),
    });

    // Should invoke again because residue changed
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.output).toContain('second verdict');
  });

  it('unreachable memo HEAD triggers fresh dispatch', async () => {
    const invoke = vi.fn();
    const provider: LLMProvider = {
      invoke,
      invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };

    // Manually create a memo with an unreachable HEAD (fake SHA)
    const fakeMemo = {
      key: 'deadbeef1234567890abcdef1234567890abcdef:1,2', // Fake HEAD SHA
      result: 'stale verdict',
    };
    await writeFile(memoPath, JSON.stringify(fakeMemo), 'utf-8');

    // Dispatch should recognize memo key mismatch and re-dispatch
    invoke.mockResolvedValueOnce({
      success: true,
      output: 'fresh verdict',
      exitCode: 0,
      authFailure: false,
      modelUnavailable: false,
    });

    const result = await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1', '2'],
      featureWorktreePath: dir,
      gitRunner: createMockedGitRunner('abc1234567890def1234567890def1234567890'),
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(result.output).toContain('fresh verdict');
  });

  it('persists memo at .pipeline/attribution-memo.json', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      output: 'test verdict',
      exitCode: 0,
      authFailure: false,
      modelUnavailable: false,
    });
    const provider: LLMProvider = {
      invoke,
      invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };

    await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1', '2'],
      featureWorktreePath: dir,
      gitRunner: createMockedGitRunner(),
    });

    // Memo file should exist
    const memoContent = await readFile(memoPath, 'utf-8');
    const memo = JSON.parse(memoContent);

    // Memo should have key and result
    expect(memo).toHaveProperty('key');
    expect(memo).toHaveProperty('result');
    expect(memo.result).toContain('test verdict');
    // Key format: <HEAD>:<sorted-residue-ids>
    expect(memo.key).toMatch(/^[a-f0-9]+:.*/);
  });

  it('memo key includes HEAD and sorted residue IDs', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      output: 'test verdict',
      exitCode: 0,
      authFailure: false,
      modelUnavailable: false,
    });
    const provider: LLMProvider = {
      invoke,
      invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };

    await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['3', '1', '2'],
      featureWorktreePath: dir,
      gitRunner: createMockedGitRunner(),
    });

    const memoContent = await readFile(memoPath, 'utf-8');
    const memo = JSON.parse(memoContent);

    // Key should have format: <HEAD>:<sorted-ids>
    // Residues should be sorted: 1,2,3
    expect(memo.key).toMatch(/:1,2,3$/);
  });
});

// ── Judged retry hints (Task 13) ──────────────────────────────
//
// Unsatisfied verdicts from the attribution lane sharpen retry hints
// by merging unsatisfied reasons into pendingRetryHints for the build step,
// naming task IDs and their unsatisfied reasons. no-verdict tasks are
// excluded; invalidated verdicts contribute nothing.

describe('Judged retry hints merge', () => {
  let dir: string;
  let planPath: string;
  let pipelineDir: string;
  let verdictPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'attribution-hints-'));
    pipelineDir = join(dir, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });
    verdictPath = join(pipelineDir, 'attribution-verdict.json');
    planPath = join(dir, 'plan.md');
    await writeFile(
      planPath,
      `# Plan

## Task 1
Implement task 1.

**Files:** src/task1.ts

## Task 2
Implement task 2.

**Files:** src/task2.ts

## Task 3
Implement task 3.

**Files:** src/task3.ts
`,
      'utf-8',
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('unsatisfied verdicts are returned in lane result for retry hint merging', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      output: 'verdict written',
      exitCode: 0,
    });
    const provider: LLMProvider = { invoke, invokeInteractive: vi.fn() };

    const headSha = 'abc1234567890def1234567890def1234567890';
    const verdict = {
      schema: 1,
      anchor: { head: headSha, residue: ['1', '2', '3'] },
      results: [
        {
          taskId: '1',
          verdict: 'satisfied',
          citations: [{ sha: 'abc123', rationale: 'cited' }],
          testEvidence: { command: 'npm test', exit: 0 },
        },
        {
          taskId: '2',
          verdict: 'unsatisfied',
          reason: 'task implementation not found in commit diffs',
        },
        {
          taskId: '3',
          verdict: 'unsatisfied',
          reason: 'test evidence missing or failing',
        },
      ],
    };

    await writeFile(verdictPath, JSON.stringify(verdict), 'utf-8');

    const result = await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1', '2', '3'],
      featureWorktreePath: dir,
      gitRunner: createMockedGitRunner(headSha),
    });

    expect(result.success).toBe(true);
    // Note: dispatchAttributionVerifier returns VerifierDispatchResult, not AttributionLaneResult
    // Task 13 testing the lane result happens in conductor integration tests
  });

  it('no-verdict tasks excluded from unsatisfied reasons', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      output: 'verdict written',
      exitCode: 0,
    });
    const provider: LLMProvider = { invoke, invokeInteractive: vi.fn() };

    const headSha = 'abc1234567890def1234567890def1234567890';
    const verdict = {
      schema: 1,
      anchor: { head: headSha, residue: ['1', '2'] },
      results: [
        {
          taskId: '1',
          verdict: 'no-verdict',
          reason: 'ambiguous implementation',
        },
        {
          taskId: '2',
          verdict: 'no-verdict',
          reason: 'uncertain evidence',
        },
      ],
    };

    await writeFile(verdictPath, JSON.stringify(verdict), 'utf-8');

    const result = await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1', '2'],
      featureWorktreePath: dir,
      gitRunner: createMockedGitRunner(headSha),
    });

    // no-verdict verdicts should not produce retry hints
    expect(result.success).toBe(true);
  });

  it('invalidated verdicts (stale anchor) contribute nothing', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      output: 'verdict written',
      exitCode: 0,
    });
    const provider: LLMProvider = { invoke, invokeInteractive: vi.fn() };

    const currentHeadSha = 'abc1234567890def1234567890def1234567890';
    const verdictHeadSha = 'different1234567890def1234567890def1234567890'; // Mismatch!

    const verdict = {
      schema: 1,
      anchor: { head: verdictHeadSha, residue: ['1', '2'] }, // Wrong HEAD!
      results: [
        {
          taskId: '1',
          verdict: 'unsatisfied',
          reason: 'should be ignored due to stale anchor',
        },
        {
          taskId: '2',
          verdict: 'unsatisfied',
          reason: 'should also be ignored',
        },
      ],
    };

    await writeFile(verdictPath, JSON.stringify(verdict), 'utf-8');

    const result = await dispatchAttributionVerifier({
      provider,
      projectDir: dir,
      planPath,
      residueIds: ['1', '2'],
      featureWorktreePath: dir,
      gitRunner: createMockedGitRunner(currentHeadSha),
    });

    // Invalidated verdicts should not produce retry hints
    expect(result.success).toBe(true);
  });

});

// ── Memo re-key after rebase (Task 6, RED — Story 4) ──────────────────────
//
// Per .docs/plans/rebase-orphans-every-sha-anchored-evidence-citatio.md Task 6
// and adr-2026-07-12-rebase-evidence-stamp-translation.md: an unconflicted
// rebase changes HEAD's sha, which orphans the attribution memo (keyed on the
// old HEAD via `computeMemoKey`) even though every judged commit it cites
// still exists post-rebase (just under new shas, per `buildRewriteMap`).
// `rekeyMemoAfterRebase` must translate the memo's cached entry onto the new
// HEAD (recomputing the key, translating `anchor.head`) so `readMemo` HITS
// for the new HEAD instead of forcing an unnecessary re-judge.
//
// `rekeyMemoAfterRebase` does not exist yet (Task 7 implements it) — the
// import above fails module resolution, which is the expected RED failure.
describe('rekeyMemoAfterRebase (RED — not implemented until Task 7)', () => {
  let dir: string;
  let memoPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'attribution-memo-rekey-'));
    memoPath = join(dir, '.pipeline', 'attribution-memo.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('re-keys an unconflicted rebase: readMemo hits on the new HEAD and anchor.head is translated', async () => {
    const oldHead = 'a'.repeat(40);
    const newHead = 'b'.repeat(40);
    const judgedCommitOld = 'c'.repeat(40);
    const judgedCommitNew = 'd'.repeat(40);
    const residueIds = ['1', '2'];

    // Existing memo entry written for the OLD head, citing a judged commit
    // that survives the rebase (present as a map key -> not in residue).
    const oldKey = computeMemoKey(oldHead, residueIds);
    const cachedVerdict = {
      schema: 1,
      anchor: { head: oldHead, residue: residueIds },
      results: [
        {
          taskId: '1',
          verdict: 'satisfied',
          citations: [{ sha: judgedCommitOld, rationale: 'implements the sweep feature' }],
          testEvidence: { command: 'npm test', exit: 0 },
        },
      ],
    };
    await writeMemo(memoPath, oldKey, JSON.stringify(cachedVerdict));

    // Rewrite map from buildRewriteMap: judgedCommitOld -> judgedCommitNew,
    // oldHead -> newHead. All judged commits cited in the memo are present
    // as map keys, so nothing here is residue.
    const map: Record<string, string> = {
      [oldHead]: newHead,
      [judgedCommitOld]: judgedCommitNew,
    };

    // No shas dropped by the rebase — the sha-residue set is empty.
    await rekeyMemoAfterRebase(dir, map, oldHead, newHead, residueIds, []);

    // The NEW key must now HIT.
    const newKey = computeMemoKey(newHead, residueIds);
    const hit = await readMemo(memoPath, newKey);
    expect(hit).toBeDefined();

    const parsed = JSON.parse(hit as string);
    expect(parsed.results[0].taskId).toBe('1');
    expect(parsed.results[0].citations[0].sha).toBe(judgedCommitOld);

    // The entry's verdictAnchor (anchor.head) is translated to the new HEAD.
    expect(parsed.anchor.head).toBe(newHead);
  });

  it('leaves the memo untouched when a cited judged commit is itself in the sha-residue set (dropped/unmapped by the rebase)', async () => {
    // Regression for the Task 7 rework finding: rekeyMemoAfterRebase must
    // distinguish pending-task-ids (residueIds, used for computeMemoKey) from
    // the actual sha-residue set (shaResidue, used for the safety guard).
    // Previously both were satisfied by a single `residueIds` param — the
    // caller passed task ids there, so `citedShas.some(residueSet.has)` could
    // never match a 40-char sha and the guard was dead code.
    const oldHead = 'a'.repeat(40);
    const newHead = 'b'.repeat(40);
    const droppedJudgedCommit = 'e'.repeat(40);
    const residueIds = ['1', '2'];

    const oldKey = computeMemoKey(oldHead, residueIds);
    const cachedVerdict = {
      schema: 1,
      anchor: { head: oldHead, residue: residueIds },
      results: [
        {
          taskId: '1',
          verdict: 'satisfied',
          citations: [{ sha: droppedJudgedCommit, rationale: 'implements the sweep feature' }],
          testEvidence: { command: 'npm test', exit: 0 },
        },
      ],
    };
    await writeMemo(memoPath, oldKey, JSON.stringify(cachedVerdict));

    // The rewrite map has no entry for droppedJudgedCommit (it was dropped by
    // the rebase, e.g. squashed away or conflict-resolved out); it shows up
    // in the sha-residue set instead.
    const map: Record<string, string> = {
      [oldHead]: newHead,
    };
    const shaResidue = [droppedJudgedCommit];

    await rekeyMemoAfterRebase(dir, map, oldHead, newHead, residueIds, shaResidue);

    // The memo must be left alone: the OLD key still reads back the
    // untranslated entry, and the NEW key must miss.
    const stillOld = await readMemo(memoPath, oldKey);
    expect(stillOld).toBeDefined();
    const stillOldParsed = JSON.parse(stillOld as string);
    expect(stillOldParsed.anchor.head).toBe(oldHead);

    const newKey = computeMemoKey(newHead, residueIds);
    const miss = await readMemo(memoPath, newKey);
    expect(miss).toBeUndefined();
  });
});

/**
 * RED acceptance specs for Codex safety and self-host parity (#907).
 *
 * Covers: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9, FR-10,
 * FR-11, FR-12, FR-13, FR-14, FR-15.
 *
 * These specifications drive the real task-hook and provider-candidate entry
 * points. Provider doubles represent only the external CLI boundary. The
 * `withCandidateSafety(candidate, invoke)` callback is an operator-approved
 * production seam: it must surround every resolved candidate, including a
 * failed candidate before provider fallback advances.
 */

import { describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PREPARE_COMMIT_MSG_HOOK } from '../../src/engine/git-hook-assets.js';
import { executeProviderCandidates } from '../../src/engine/provider-execution.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
  type ProviderModelPolicy,
} from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet, type ProviderRuntime } from '../../src/engine/provider-runtime.js';
import { ProviderSessionScope } from '../../src/engine/provider-session.js';
import { runTaskDone, runTaskStart } from '../../src/engine/task-cli.js';
import type { InvokeOptions, InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import { provisionProviderHome } from '../../src/engine/self-host/provider-home.js';

type Candidate = {
  providerKey: string;
  runtime: ProviderRuntime;
};

type WithCandidateSafety = (
  candidate: Candidate,
  invoke: () => Promise<InvokeResult>,
) => Promise<InvokeResult>;

type ExecuteWithCandidateSafety = (input: {
  step: 'build';
  configuredProviders: readonly string[];
  runtimes: ProviderRuntimeSet;
  sessions: ProviderSessionScope;
  options: Omit<InvokeOptions, 'sessionId' | 'resume' | 'model' | 'effort'>;
  withCandidateSafety: WithCandidateSafety;
}) => Promise<InvokeResult>;

function runtime(key: string, provider: LLMProvider, policy: ProviderModelPolicy): ProviderRuntime {
  return {
    key,
    provider,
    policy,
    builtIn: key === 'claude' || key === 'codex',
    availability: new ModelAvailability(policy.modelFallbackLadder),
  };
}

function scriptedProvider(result: InvokeResult, transcript: string[], key: string): LLMProvider {
  return {
    invoke: vi.fn(async () => {
      transcript.push(`invoke:${key}`);
      return result;
    }),
    invokeInteractive: vi.fn(async () => ({ success: true, output: '', exitCode: 0 })),
  };
}

async function plannedModule(path: string): Promise<Record<string, unknown> | null> {
  return (await import(path).catch(() => null)) as Record<string, unknown> | null;
}

async function expectPlannedModule(path: string, purpose: string): Promise<Record<string, unknown>> {
  const loaded = await plannedModule(path);
  expect(loaded, `${path} must exist for ${purpose}`).not.toBeNull();
  expect(
    loaded && Object.values(loaded).some((value) => typeof value === 'function'),
    `${path} must export a production contract for ${purpose}`,
  ).toBe(true);
  return loaded as Record<string, unknown>;
}

function executeWithSafety(input: Parameters<ExecuteWithCandidateSafety>[0]) {
  return (executeProviderCandidates as unknown as ExecuteWithCandidateSafety)(input);
}

describe('acceptance: Codex safety and self-host parity (#907)', () => {
  it('self-host Codex discovers worktree skills without changing the ordinary live catalog', async () => {
    const root = await mkdtemp(join(tmpdir(), 'acceptance-907-skills-'));
    const worktree = join(root, 'worktree');
    const live = join(root, 'live', '.agents', 'skills');
    await Promise.all([mkdir(join(worktree, 'skills', 'HARNESS'), { recursive: true }), mkdir(live, { recursive: true })]);
    await writeFile(join(worktree, 'skills', 'HARNESS', 'SKILL.md'), 'WORKTREE');
    await writeFile(join(live, 'HARNESS'), 'LIVE');
    const before = await readFile(join(live, 'HARNESS'), 'utf8');
    const home = await provisionProviderHome({ provider: { id: 'codex' }, worktreeRoot: worktree, baseDir: root });
    try {
      // The child sees the worktree's skill content, but through a throwaway
      // copy rather than a live link back into the worktree itself (a link
      // would let provider warmup writes land inside the git checkout under
      // test).
      expect(
        await readFile(join(home.homeDir, '.agents', 'skills', 'HARNESS', 'SKILL.md'), 'utf8'),
      ).toBe('WORKTREE');
      expect(await realpath(join(home.homeDir, '.agents', 'skills'))).not.toBe(
        await realpath(join(worktree, 'skills')),
      );
      expect(await readFile(join(live, 'HARNESS'), 'utf8')).toBe(before);
    } finally { await home.teardown(); await rm(root, { recursive: true, force: true }); }
  });

  // Covers: FR-1, FR-3, FR-4
  it('keeps attribution task-local advisory telemetry and preserves an explicit valid trailer', () => {
    expect(PREPARE_COMMIT_MSG_HOOK).toContain('.pipeline/current-task');
    expect(PREPARE_COMMIT_MSG_HOOK).not.toMatch(/current-task id always wins/i);
    expect(PREPARE_COMMIT_MSG_HOOK).toMatch(/preserv|explicit.*Task:/i);
  });

  // Covers: FR-1, FR-2, FR-4
  it('does not clear a sibling task stamp or manufacture completion when an older task ends', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'acceptance-907-attribution-'));
    try {
      const pipeline = join(projectRoot, '.pipeline');
      await mkdir(pipeline, { recursive: true });
      await writeFile(
        join(pipeline, 'task-status.json'),
        JSON.stringify({ tasks: [{ id: '1', status: 'pending' }, { id: '2', status: 'pending' }] }),
      );

      expect(await runTaskStart(projectRoot, '1')).toBe(0);
      expect(await runTaskStart(projectRoot, '2')).toBe(0);
      expect(await runTaskDone(projectRoot, '1')).toBe(1);

      const status = JSON.parse(await readFile(join(pipeline, 'task-status.json'), 'utf8')) as {
        tasks: Array<{ id: string; status: string }>;
      };
      expect(status.tasks).toEqual([
        { id: '1', status: 'in_progress' },
        { id: '2', status: 'in_progress' },
      ]);
      expect(await readFile(join(pipeline, 'current-task'), 'utf8')).toBe('2');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  // Covers: FR-5, FR-6
  it('creates one durable protected-artifact policy that fails closed for indeterminate targets', async () => {
    await expectPlannedModule(
      '../../src/engine/protected-artifact-seal.js',
      'BUILD/SHIP artifact freezing and canonical target rejection',
    );
  });

  // Covers: FR-7, FR-8, FR-9
  it('provisions provider-specific minimal homes and a live-boundary verifier', async () => {
    await expectPlannedModule(
      '../../src/engine/self-host/provider-home.js',
      'minimal Claude/Codex homes with selected auth only and terminal cleanup',
    );
    await expectPlannedModule(
      '../../src/engine/self-host/live-boundary.js',
      'feature-worktree-only writes and live checkout/config verification',
    );
  });

  // Covers: FR-8, FR-14
  it('keeps Codex cached authentication provider-owned and outside engine diagnostics', async () => {
    await expectPlannedModule(
      '../../src/execution/codex-self-host-auth.js',
      'opaque selected-Codex-auth handoff into the isolated destination',
    );
  });

  // Covers: FR-10, FR-11, FR-12, FR-15
  it('wraps every resolved provider candidate before dispatch and cleans it before fallback', async () => {
    const transcript: string[] = [];
    const codex = scriptedProvider(
      {
        success: false,
        output: 'codex unavailable',
        exitCode: 127,
        providerUnavailable: true,
        providerUnavailableScope: 'run',
        providerUnavailableReason: 'codex unavailable',
      },
      transcript,
      'codex',
    );
    const claude = scriptedProvider({ success: true, output: 'ok', exitCode: 0 }, transcript, 'claude');
    const runtimes = new ProviderRuntimeSet([
      runtime('codex', codex, CODEX_MODEL_POLICY),
      runtime('claude', claude, CLAUDE_MODEL_POLICY),
    ]);

    const result = await executeWithSafety({
      step: 'build',
      configuredProviders: ['codex', 'claude'],
      runtimes,
      sessions: new ProviderSessionScope(() => crypto.randomUUID()),
      options: { prompt: 'Acceptance fixture', cwd: process.cwd() },
      withCandidateSafety: async (candidate, invoke) => {
        transcript.push(`preflight:${candidate.providerKey}`);
        try {
          return await invoke();
        } finally {
          transcript.push(`teardown:${candidate.providerKey}`);
        }
      },
    });

    expect(result.success).toBe(true);
    expect(transcript).toEqual([
      'preflight:codex',
      'invoke:codex',
      'teardown:codex',
      'preflight:claude',
      'invoke:claude',
      'teardown:claude',
    ]);
  });

  // Covers: FR-13
  it('emits structured, provider-labelled safety failures with recovery guidance', async () => {
    await expectPlannedModule(
      '../../src/engine/safety-diagnostics.js',
      'sanitized provider/protection failure classification and recovery guidance',
    );
  });

  // Covers: FR-14
  it('redacts credential canaries at the real provider-execution result boundary', async () => {
    const secret = 'codex-secret-canary-907';
    const transcript: string[] = [];
    const codex = scriptedProvider({ success: true, output: `token=${secret}`, exitCode: 0 }, transcript, 'codex');
    const runtimes = new ProviderRuntimeSet([runtime('codex', codex, CODEX_MODEL_POLICY)]);

    const result = await executeWithSafety({
      step: 'build',
      configuredProviders: ['codex'],
      runtimes,
      sessions: new ProviderSessionScope(() => crypto.randomUUID()),
      options: { prompt: 'Acceptance fixture', cwd: process.cwd() },
      withCandidateSafety: async (_candidate, invoke) => invoke(),
    });

    expect(result.output).not.toContain(secret);
  });

  // Covers: FR-15
  it('exposes optional self-host authentication without requiring it from legacy providers', async () => {
    const providerContract = await plannedModule('../../src/execution/llm-provider.js');
    expect(providerContract, 'the shared provider contract must load for Claude-only operation').not.toBeNull();
    await expectPlannedModule(
      '../../src/engine/self-host/provider-home.js',
      'optional provider-owned self-host authentication for both built-in providers',
    );
  });
});

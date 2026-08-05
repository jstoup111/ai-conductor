import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { ClaudeProvider, parseJsonResult } from '../../src/execution/claude-provider.js';
import { Conductor } from '../test-conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { provisionProviderHome } from '../../src/engine/self-host/provider-home.js';

const worktreeRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const configuredCustomSteps = [
  'maintain-documentation',
  'release-disposition',
] as const;
const unresolvedEnvelopePath = fileURLToPath(
  new URL('../fixtures/claude-envelopes/unresolved-command.json', import.meta.url),
);
const successfulEnvelopePath = fileURLToPath(
  new URL('../fixtures/claude-envelopes/successful-command.json', import.meta.url),
);

async function invokeEnvelope(prompt: string, envelope: Record<string, unknown>) {
  const provider = new ClaudeProvider(undefined, () => Promise.resolve({
    stdout: JSON.stringify(envelope),
    stderr: '',
    exitCode: 0,
    failed: false,
  }) as never);
  return provider.invoke({ prompt, sessionId: 'unresolved-command-fixture', resume: false });
}

describe('Claude custom-step command resolution evidence (#1311)', () => {
  it('reports the pinned zero-turn /pipeline envelope as an unresolved command failure', async () => {
    const unresolvedRaw = await readFile(unresolvedEnvelopePath, 'utf8');
    const provider = new ClaudeProvider(undefined, () => Promise.resolve({
      stdout: unresolvedRaw,
      stderr: '',
      exitCode: 0,
      failed: false,
    }) as never);

    await expect(provider.invoke({
      prompt: '/pipeline',
      sessionId: 'unresolved-command-fixture',
      resume: false,
    })).resolves.toMatchObject({
      success: false,
      exitCode: 0,
      commandUnresolved: true,
      commandUnresolvedName: 'pipeline',
    });
  });

  it('classifies from raw zero turns when token counts and the process exit code are zero', async () => {
    const envelope = {
      subtype: 'success', is_error: false, num_turns: 0,
      result: 'Unknown command: /pipeline',
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
    };

    expect(parseJsonResult(JSON.stringify(envelope)).numTurns).toBe(0);
    await expect(invokeEnvelope('/pipeline', envelope)).resolves.toMatchObject({
      success: false,
      exitCode: 0,
      commandUnresolved: true,
      commandUnresolvedName: 'pipeline',
    });
  });

  it('halts an unresolved command mechanically without retrying, escalating, or changing providers', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'unresolved-command-conductor-'));
    const stateFilePath = join(projectRoot, 'conduct-state.json');
    await writeFile(stateFilePath, JSON.stringify({
      worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
      complexity_tier: 'S', track: 'technical', stories: 'done', conflict_check: 'done',
      plan: 'done', coherence_check: 'done', architecture_diagram: 'done',
      architecture_review: 'done', acceptance_specs: 'done',
    }));
    const events = new ConductorEventEmitter();
    const retries: unknown[] = [];
    events.on('step_retry', (event) => { retries.push(event); });
    const runner = {
      run: vi.fn(async () => ({
        success: false,
        output: 'Unknown command: /pipeline',
        commandUnresolved: true,
        commandUnresolvedName: 'pipeline',
        actualProvider: 'claude',
        attempts: [{ provider: 'claude', invoked: true }],
      })),
    } as unknown as StepRunner;
    const escalateBuildFailure = vi.fn(async () => ({}));
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      stepRunner: runner,
      events,
      fromStep: 'build',
      mode: 'auto',
      daemon: false,
      maxRetries: 3,
      escalateBuildFailure,
    });

    try {
      await conductor.run();
      expect({
        calls: vi.mocked(runner.run).mock.calls.length,
        retries,
        escalationCalls: escalateBuildFailure.mock.calls.length,
        haltClass: await readFile(join(projectRoot, '.pipeline', 'HALT.class'), 'utf8'),
      }).toEqual({
        calls: 1,
        retries: [],
        escalationCalls: 0,
        haltClass: 'mechanical',
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('keeps prose, bare zero-turn, and mismatched-command results successful', async () => {
    const [prose, bareZeroTurn, differentCommand] = await Promise.all([
      invokeEnvelope('/pipeline', {
        subtype: 'success', is_error: false, num_turns: 3,
        result: 'I fixed an unknown command reported by the test.',
        usage: { input_tokens: 12, output_tokens: 5 },
      }),
      invokeEnvelope('/pipeline', {
        subtype: 'success', is_error: false, num_turns: 0,
        result: 'No work was required.',
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
      invokeEnvelope('/pipeline', {
        subtype: 'success', is_error: false, num_turns: 0,
        result: 'Unknown command: /stories',
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    ]);

    for (const result of [prose, bareZeroTurn, differentCommand]) {
      expect(result.success).toBe(true);
      expect(result.commandUnresolved).toBeUndefined();
      expect(result.commandUnresolvedName).toBeUndefined();
    }
  });

  it('pins the observed zero-turn unresolved-command envelope beside an ordinary success', async () => {
    const [unresolvedRaw, successfulRaw] = await Promise.all([
      readFile(unresolvedEnvelopePath, 'utf8'),
      readFile(successfulEnvelopePath, 'utf8'),
    ]);
    const unresolved = JSON.parse(unresolvedRaw) as Record<string, unknown>;
    const successful = JSON.parse(successfulRaw) as Record<string, unknown>;

    expect(unresolved).toEqual({
      subtype: 'success',
      is_error: false,
      num_turns: 0,
      result: 'Unknown command: /pipeline',
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    expect(parseJsonResult(unresolvedRaw)).toEqual({
      output: 'Unknown command: /pipeline',
      tokenUsage: { input: 0, output: 0, costUsd: 0, numTurns: 0 },
      numTurns: 0,
    });
    expect(successful).toMatchObject({
      subtype: 'success',
      is_error: false,
      num_turns: expect.any(Number),
    });
    expect(parseJsonResult(successfulRaw).tokenUsage).toMatchObject({
      input: expect.any(Number),
      output: expect.any(Number),
    });
  });

  it('records that the provisioned Claude home cannot contain this repo’s config-declared custom steps', async () => {
    // This is deliberately filesystem-only evidence, not a live Claude claim:
    // credentialed CLI confirmation remains gated on CLAUDE_CODE_OAUTH_TOKEN.
    // The live smoke provisions this exact home shape before dispatch.
    const baseDir = await mkdtemp(join(tmpdir(), 'claude-custom-step-resolution-'));
    const config = await readFile(join(worktreeRoot, '.ai-conductor', 'config.yml'), 'utf8');
    const home = await provisionProviderHome({
      provider: { id: 'claude' },
      worktreeRoot,
      baseDir,
    });

    try {
      expect(home.childEnv().CLAUDE_CONFIG_DIR).toBe(home.homeDir);

      for (const step of configuredCustomSteps) {
        expect(config).toContain(`  ${step}:`);
        expect(config).toContain(`skill: .agents/skills/${step}/SKILL.md`);
        // These are the configured `.agents/skills` sources, not entries in
        // the copied `skills/` catalog Claude receives in its isolated home.
        await expect(
          access(join(worktreeRoot, '.agents', 'skills', step, 'SKILL.md')),
        ).resolves.toBeUndefined();
        await expect(access(join(home.homeDir, 'skills', step, 'SKILL.md'))).rejects.toThrow();
      }
    } finally {
      await home.teardown();
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});

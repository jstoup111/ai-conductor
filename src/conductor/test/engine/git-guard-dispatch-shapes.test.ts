// Covers: task:10
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { executeAuxiliaryProviderCandidates, executeProviderCandidates } from '../../src/engine/provider-execution.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionScope } from '../../src/engine/provider-session.js';
import { prepareWorktree } from '../../src/engine/worktree-prepare.js';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import { initTestRepo } from '../fixtures/git-repo.js';

// Real adapters, real guard provisioning; only the provider process boundary
// is a recorder, so no test here launches Claude or Codex.
type Spawn = { provider: 'claude' | 'codex'; args: readonly string[]; path: string | undefined };
type Reply = { stdout: string; stderr: string; exitCode: number };

const CLAUDE_OK: Reply = { stdout: JSON.stringify({ type: 'result', result: 'complete' }), stderr: '', exitCode: 0 };
const CODEX_OK: Reply = {
  stdout: [
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'complete' } }),
    JSON.stringify({ type: 'turn.completed' }),
  ].join('\n'),
  stderr: '', exitCode: 0,
};

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function preparedWorktree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'git-guard-dispatch-shape-'));
  roots.push(root);
  await initTestRepo(root);
  await prepareWorktree(root);
  return root;
}

function recorder(provider: Spawn['provider'], spawns: Spawn[], replies: Reply[]) {
  return vi.fn(async (_file: string, args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
    spawns.push({ provider, args, path: options.env?.PATH });
    return replies.shift() ?? (provider === 'claude' ? CLAUDE_OK : CODEX_OK);
  });
}

function runtimes(spawns: Spawn[], replies: { claude?: Reply[]; codex?: Reply[] }): ProviderRuntimeSet {
  const claude = new ClaudeProvider(undefined, recorder('claude', spawns, replies.claude ?? []) as never);
  const codex = new CodexProvider(
    vi.fn(async () => ({
      stdout: JSON.stringify({ schemaVersion: 1, auth: { selectedMode: 'cached-login', configured: true }, transport: { authenticated: true } }),
      exitCode: 0,
    })),
    'codex', undefined, recorder('codex', spawns, replies.codex ?? []) as never,
  );
  return new ProviderRuntimeSet([
    { key: 'claude', provider: claude, lifecycleCapability: claude.lifecycleCapability, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) },
    { key: 'codex', provider: codex, lifecycleCapability: codex.lifecycleCapability, nativeSchemaCapability: codex.nativeSchemaCapability, policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder) },
  ]);
}

const sessions = () => new ProviderSessionScope(vi.fn().mockReturnValue('dispatch-shape-session'));
const options = (cwd: string) => ({ prompt: 'Build.', cwd, interactive: false });

function expectAllGuarded(spawns: Spawn[], root: string): void {
  for (const spawn of spawns) expect(spawn.path?.split(':')[0]).toBe(join(root, '.pipeline', 'bin'));
}

describe('every dispatch shape reaches the provider with the guarded PATH', () => {
  it('guards an initial dispatch', async () => {
    const root = await preparedWorktree();
    const spawns: Spawn[] = [];

    const result = await executeProviderCandidates({
      step: 'build', configuredProviders: ['claude'], runtimes: runtimes(spawns, {}), sessions: sessions(), options: options(root),
    });

    expect(result.success).toBe(true);
    expect(spawns.map((spawn) => spawn.provider)).toEqual(['claude']);
    expectAllGuarded(spawns, root);
  });

  it('guards a model-fallback rung retry', async () => {
    expect(CODEX_MODEL_POLICY.modelFallbackLadder.length).toBeGreaterThan(1);
    const root = await preparedWorktree();
    const spawns: Spawn[] = [];

    const result = await executeProviderCandidates({
      step: 'build', configuredProviders: ['codex'], sessions: sessions(), options: options(root),
      modelOverride: CODEX_MODEL_POLICY.modelFallbackLadder[0],
      runtimes: runtimes(spawns, { codex: [{ stdout: '', stderr: 'error: model not found', exitCode: 1 }] }),
    });

    expect(result.success).toBe(true);
    expect(spawns.map((spawn) => spawn.provider)).toEqual(['codex', 'codex']);
    expect(spawns[0].args).not.toEqual(spawns[1].args); // a different ladder rung
    expectAllGuarded(spawns, root);
  });

  it('guards a replacement-provider candidate after the first provider is unavailable', async () => {
    const root = await preparedWorktree();
    const spawns: Spawn[] = [];

    const result = await executeProviderCandidates({
      step: 'build', configuredProviders: ['codex', 'claude'], sessions: sessions(), options: options(root),
      runtimes: runtimes(spawns, { codex: [{ stdout: '', stderr: '', exitCode: 127 }] }),
    });

    expect(result).toMatchObject({ success: true, actualProvider: 'claude' });
    expect(spawns.map((spawn) => spawn.provider)).toEqual(['codex', 'claude']);
    expectAllGuarded(spawns, root);
  });

  it('guards an auxiliary dispatch', async () => {
    const root = await preparedWorktree();
    const spawns: Spawn[] = [];

    const result = await executeAuxiliaryProviderCandidates({
      step: 'build_review', memberId: 'security', runtimes: runtimes(spawns, {}), sessions: sessions(),
      runId: 'dispatch-shape-aux',
      policy: {
        enabled: true, max_projection_bytes: 1_048_576, llm_provider: 'codex', model: CODEX_MODEL_POLICY.modelFallbackLadder[0],
        effort: 'high', model_fallback_ladder: [CODEX_MODEL_POLICY.modelFallbackLadder[0]], max_retries: 1, escalate: false, min_confidence: 0,
      },
      options: options(root),
    });

    expect(result.success).toBe(true);
    expect(spawns.map((spawn) => spawn.provider)).toEqual(['codex']);
    expectAllGuarded(spawns, root);
  });
});

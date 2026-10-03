import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { prepareManagedSessionObservationDestination } from '../../src/execution/managed-session-preparation.js';
import { executeProviderCandidates } from '../../src/engine/provider-execution.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionScope } from '../../src/engine/provider-session.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function context() {
  const root = await mkdtemp(join(tmpdir(), 'managed-session-preparation-'));
  roots.push(root);
  const worktreeRoot = join(root, 'worktree');
  const producerRoot = join(worktreeRoot, '.pipeline', 'session-events', 'dispatch-1');
  await mkdir(producerRoot, { recursive: true });
  return {
    projectRoot: root, worktreeRoot, producerRoot, dispatchId: 'dispatch-1', provider: 'codex',
    scope: { kind: 'feature' as const, featureSlug: 'feature-a' },
  };
}

describe('managed observation destination preparation', () => {
  it('admits only a proven per-dispatch producer destination under the read-only policy', async () => {
    const managed = await context();
    const probe = vi.fn(async () => ({ producerWrite: 'allowed' as const, protectedWrites: 'refused' as const }));

    await expect(prepareManagedSessionObservationDestination({
      provider: 'codex', context: managed, readOnlyReview: true, probe,
    })).resolves.toEqual({ producerRoot: managed.producerRoot });
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({
      producerRoot: managed.producerRoot,
      protectedPaths: [
        managed.worktreeRoot,
        join(managed.worktreeRoot, '.pipeline', 'sealed'),
        join(managed.worktreeRoot, '.pipeline', 'unrelated'),
        join(managed.projectRoot, '.codex'),
      ],
    }));
  });

  it('refuses before provider launch when native read-only availability cannot prove observation access', async () => {
    const managed = await context();
    const invoke = vi.fn(async () => ({ success: true, output: 'must not run', exitCode: 0 }));
    const result = await executeProviderCandidates({
      step: 'build_review', configuredProviders: ['codex'], preferredProvider: 'codex',
      runtimes: new ProviderRuntimeSet([{ key: 'codex', provider: { invoke }, policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder) }]),
      sessions: new ProviderSessionScope(vi.fn()),
      options: { prompt: 'review', cwd: managed.worktreeRoot, readOnlyReview: true, managedSessionContext: managed },
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(result.providerSetupExhaustion?.candidates).toEqual([expect.objectContaining({
      provider: 'codex', capability: 'managed-observation-destination',
      recoveryAction: expect.stringContaining('observation destination'),
    })]);
  });
});

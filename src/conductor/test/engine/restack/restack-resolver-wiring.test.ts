// Covers: task:2, task:9
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { restackResolverForStepRunner } from '../../../src/engine/daemon-feature-lifecycle.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import type { ExecuteProviderCandidatesInput, ProviderExecutionResult } from '../../../src/engine/provider-execution.js';
import { ProviderRuntimeSet } from '../../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../../src/engine/provider-session.js';
import { resolveRestackConflict } from '../../../src/engine/restack/restack-resolver.js';
import { parseCommitSha, type CommitSha } from '../../../src/engine/restack/restack-types.js';
import { DefaultStepRunner } from '../../../src/engine/step-runners.js';
import type { InvokeOptions, LLMProvider } from '../../../src/execution/llm-provider.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const stamp = { name: 'Journal Committer', email: 'journal@example.test', date: '2030-02-03T04:05:06Z' };

function sha(value: string): CommitSha {
  const parsed = parseCommitSha(value.trim());
  if (!parsed) throw new Error(`expected SHA, got ${value}`);
  return parsed;
}

async function invokeThroughDaemonResolver(
  stepRunner: Pick<DefaultStepRunner, 'resolveRebaseConflict'>,
  operatorDecision?: { answer: string; commit: string; paths: readonly string[] },
) {
  const repo = await mkdtemp(join(tmpdir(), 'restack-resolver-wiring-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.name', 'Fixture']);
  await git(['config', 'user.email', 'fixture@example.test']);
  await writeFile(join(repo, 'shared.txt'), 'base\n');
  await git(['add', 'shared.txt']);
  await git(['commit', '-qm', 'base']);
  const oldParent = sha((await git(['rev-parse', 'HEAD'])).stdout);
  await git(['checkout', '-qb', 'child']);
  await writeFile(join(repo, 'shared.txt'), 'child\n');
  await git(['commit', '-am', 'child change', '-q']);
  const oldTip = sha((await git(['rev-parse', 'HEAD'])).stdout);
  await git(['checkout', '-q', 'main']);
  await writeFile(join(repo, 'shared.txt'), 'main\n');
  await git(['commit', '-am', 'main change', '-q']);
  const newParent = sha((await git(['rev-parse', 'HEAD'])).stdout);

  const resolver = restackResolverForStepRunner(stepRunner);
  if (!resolver) throw new Error('expected daemon resolver wiring');
  await resolveRestackConflict({
    worktree: repo,
    range: { child: parseChildId(2)!, oldParent, oldTip, kind: 'active' },
    newParent,
    stamp,
    resolver,
    cap: 1,
    ...(operatorDecision === undefined ? {} : { operatorDecision }),
  });
}

function refusal(): ProviderExecutionResult {
  return {
    success: true,
    output: '{"resolved": false, "reason": "stop after observing context"}',
    exitCode: 0,
    preferredProvider: 'claude',
    attempts: [],
  };
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

describe('restack resolver production wiring', () => {
  it('passes the supplied operator decision through the daemon-wired step runner', async () => {
    const operatorDecision = { answer: 'keep upstream', commit: 'a'.repeat(40), paths: ['shared.txt'] };
    const resolveRebaseConflict = vi.fn(async () => ({ resolved: false as const, reason: 'stop after observing context' }));

    await invokeThroughDaemonResolver({ resolveRebaseConflict }, operatorDecision);

    expect(resolveRebaseConflict).toHaveBeenCalledWith(expect.objectContaining({ operatorDecision }));
  });

  it('does not add an operator decision when none was supplied', async () => {
    const resolveRebaseConflict = vi.fn(async () => ({ resolved: false as const, reason: 'stop after observing context' }));

    await invokeThroughDaemonResolver({ resolveRebaseConflict });

    expect(resolveRebaseConflict).toHaveBeenCalledWith(expect.not.objectContaining({ operatorDecision: expect.anything() }));
  });

  it('passes the restack environment through the provider-aware resolver dispatch', async () => {
    let options: Omit<InvokeOptions, 'sessionId' | 'resume'> | undefined;
    const providerExecutor = vi.fn(async (input: ExecuteProviderCandidatesInput) => {
      options = input.options;
      return refusal();
    });
    const runner = new DefaultStepRunner({ invoke: vi.fn() }, 'provider-aware', '/fixture', {
      providerRuntimes: new ProviderRuntimeSet([]),
      sessionStore: new ProviderSessionStore(),
      providerExecutor,
    });

    await invokeThroughDaemonResolver(runner);

    expect(options?.environmentOverlay).toMatchObject({
      GIT_CONFIG_KEY_0: 'core.hooksPath',
      GIT_COMMITTER_NAME: stamp.name,
    });
  });

  it('passes the restack environment through the fallback model ladder', async () => {
    const invoke = vi.fn(async (): Promise<ProviderExecutionResult> => refusal());
    const runner = new DefaultStepRunner({ invoke } as LLMProvider, 'fallback', '/fixture');

    await invokeThroughDaemonResolver(runner);

    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      environmentOverlay: expect.objectContaining({
        GIT_CONFIG_KEY_0: 'core.hooksPath',
        GIT_COMMITTER_NAME: stamp.name,
      }),
    }));
  });

  it('omits the environment overlay when the resolution context has no environment', async () => {
    const invoke = vi.fn(async (): Promise<ProviderExecutionResult> => refusal());
    const runner = new DefaultStepRunner({ invoke } as LLMProvider, 'no-environment', '/fixture');

    await runner.resolveRebaseConflict({ conflicts: [], projectRoot: '/fixture', baseRef: 'HEAD' });

    expect(invoke).toHaveBeenCalledWith(expect.not.objectContaining({ environmentOverlay: expect.anything() }));
  });
});

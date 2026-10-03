import { access, constants, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  composePreparedManagedSessionEnvironment,
  prepareManagedGhObservation,
} from '../../src/execution/managed-session-preparation.js';
import { GH_OBSERVER_REAL_EXECUTABLE_ENV } from '../../src/execution/gh-observer-passthrough.js';
import type { ManagedSessionContext } from '../../src/execution/managed-session-context.js';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import { PiProvider } from '../../src/execution/pi-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function context(): Promise<ManagedSessionContext> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'managed-gh-provisioning-'));
  roots.push(projectRoot);
  const worktreeRoot = join(projectRoot, 'worktree');
  const producerRoot = join(worktreeRoot, '.pipeline', 'session-events', 'dispatch-18');
  await mkdir(producerRoot, { recursive: true });
  return {
    projectRoot, worktreeRoot, producerRoot, dispatchId: 'dispatch-18', provider: 'codex',
    scope: { kind: 'feature', featureSlug: 'feature-a' },
  };
}

describe('managed gh observation provisioning', () => {
  it('resolves real gh before its managed-child PATH overlay and preserves inherited operator state', async () => {
    const managed = await context();
    const resolvedPaths: string[] = [];
    const prepared = await prepareManagedGhObservation({
      context: managed,
      environment: { PATH: '/operator/bin', KEEP: 'operator-value' },
      resolveExecutable: async (_program, environment) => {
        resolvedPaths.push(environment.PATH ?? '');
        return '/operator/bin/gh';
      },
      observerModuleUrl: 'file:///observer.mjs',
    });

    const env = composePreparedManagedSessionEnvironment(managed, {
      PATH: '/operator/bin', KEEP: 'operator-value', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/worktree/.pipeline/git-hooks',
    });

    expect(resolvedPaths).toEqual(['/operator/bin']);
    expect(env).toMatchObject({
      KEEP: 'operator-value',
      GIT_CONFIG_KEY_0: 'core.hooksPath',
      [GH_OBSERVER_REAL_EXECUTABLE_ENV]: '/operator/bin/gh',
    });
    expect(env.PATH).toBe(`${prepared.wrapperDirectory}:/operator/bin`);
    expect(await readFile(join(prepared.wrapperDirectory, 'gh'), 'utf8')).toContain('runGhObserverFromEnvironment');
    await expect(access(join(prepared.wrapperDirectory, 'gh'), constants.X_OK)).resolves.toBeUndefined();
    expect(prepared.coverage).toEqual({ boundary: 'managed-path-resolved-gh', completeness: 'unknown' });
  });

  it('does not modify operator or unrelated environments, and reports unobserved transports as unknown completeness', async () => {
    const managed = await context();
    const operatorEnvironment = { PATH: '/operator/bin', KEEP: 'operator-value' };
    const prepared = await prepareManagedGhObservation({
      context: managed,
      environment: operatorEnvironment,
      resolveExecutable: async () => '/operator/bin/gh',
      observerModuleUrl: 'file:///observer.mjs',
    });

    expect(operatorEnvironment).toEqual({ PATH: '/operator/bin', KEEP: 'operator-value' });
    expect(composePreparedManagedSessionEnvironment(undefined, operatorEnvironment)).toBe(operatorEnvironment);
    expect(prepared.coverage.completeness).toBe('unknown');
  });

  it.each([
    'an absolute gh binary',
    'a child that replaces PATH',
    'a custom GitHub HTTP or SDK client',
    'a separate MCP transport',
  ])('reports unknown completeness when observations cannot cover %s', async (_outsideBoundary) => {
    const managed = await context();
    const prepared = await prepareManagedGhObservation({
      context: managed,
      environment: { PATH: '/operator/bin' },
      resolveExecutable: async () => '/operator/bin/gh',
      observerModuleUrl: 'file:///observer.mjs',
    });

    // These routes do not execute through the PATH wrapper. Their absent
    // observations are deliberately not evidence that no GitHub write ran.
    expect(prepared.coverage).toEqual({
      boundary: 'managed-path-resolved-gh',
      completeness: 'unknown',
    });
  });

  it.each([
    ['claude', (calls: NodeJS.ProcessEnv[]) => new ClaudeProvider(undefined, ((_file: string, _args: string[], launch: { env?: NodeJS.ProcessEnv }) => {
      calls.push(launch.env ?? {}); return Promise.resolve({ stdout: JSON.stringify({ type: 'result', result: 'done' }), stderr: '', exitCode: 0, failed: false } as any);
    }) as never)],
    ['codex', (calls: NodeJS.ProcessEnv[]) => new CodexProvider(vi.fn(async () => ({ stdout: JSON.stringify({ schemaVersion: 1, auth: { selectedMode: 'cached-login', configured: true }, transport: { authenticated: true } }), exitCode: 0 })) as never, 'codex', undefined, ((_file: string, _args: readonly string[], launch: { env?: NodeJS.ProcessEnv }) => {
      calls.push(launch.env ?? {}); return Promise.resolve({ stdout: `${JSON.stringify({ type: 'turn.completed' })}\n`, stderr: '', exitCode: 0, failed: false } as any);
    }) as never)],
    ['pi', (calls: NodeJS.ProcessEnv[]) => new PiProvider('pi', ((_file: string, _args: readonly string[], launch: { env?: NodeJS.ProcessEnv }) => {
      calls.push(launch.env ?? {}); return Promise.resolve({ stdout: JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } }), stderr: '', exitCode: 0, failed: false } as any);
    }) as never)],
  ] as const)('adds the wrapper only to the prepared %s child environment', async (_provider, create) => {
    const managed = await context();
    const prepared = await prepareManagedGhObservation({ context: managed, environment: { PATH: '/operator/bin' }, resolveExecutable: async () => '/operator/bin/gh', observerModuleUrl: 'file:///observer.mjs' });
    const calls: NodeJS.ProcessEnv[] = [];
    const provider = create(calls);
    const options: InvokeOptions = { prompt: 'Run.', sessionId: 'session', resume: false, managedSessionContext: managed };

    await provider.invoke(options);

    expect(calls[0]?.PATH).toMatch(new RegExp(`^${prepared.wrapperDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`));
    expect(calls[0]?.[GH_OBSERVER_REAL_EXECUTABLE_ENV]).toBe('/operator/bin/gh');
  });
});

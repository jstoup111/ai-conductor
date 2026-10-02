import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  composeManagedSessionEnvironment,
  prepareManagedSessionContext,
  validateManagedSessionProducerPath,
  type ManagedSessionContext,
} from '../../src/execution/managed-session-context.js';

const contexts: string[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(): Promise<{ root: string; context: Omit<ManagedSessionContext, 'projectRoot' | 'worktreeRoot' | 'producerRoot'> & { projectRoot: string; worktreeRoot: string; producerRoot: string } }> {
  const root = await mkdtemp(join(tmpdir(), 'managed-session-context-'));
  contexts.push(root);
  const projectRoot = join(root, 'project');
  const worktreeRoot = join(projectRoot, '.worktrees', 'feature-a');
  const producerRoot = join(worktreeRoot, '.pipeline', 'session-events', 'dispatch-1');
  await mkdir(producerRoot, { recursive: true });
  return {
    root,
    context: {
      projectRoot,
      worktreeRoot,
      scope: { kind: 'feature', featureSlug: 'feature-a' },
      dispatchId: 'dispatch-1',
      provider: 'codex',
      producerRoot,
    },
  };
}

describe('prepareManagedSessionContext', () => {
  it('rejects a daemon feature dispatch without feature attribution before launch', async () => {
    const { context } = await fixture();
    const result = await prepareManagedSessionContext({ ...context, scope: undefined, daemonFeature: true });

    expect(result).toEqual({ ok: false, code: 'missing-feature-scope', missing: 'feature scope' });
  });

  it('keeps engine ownership authoritative over candidate environment overrides', async () => {
    const { context } = await fixture();
    const result = await prepareManagedSessionContext(context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const env = composeManagedSessionEnvironment(result.context, {
      CONDUCT_MANAGED_SESSION_CONTEXT: '{"scope":{"kind":"feature","featureSlug":"forged"}}',
      CONDUCT_MANAGED_FEATURE: 'forged',
      CONDUCT_MANAGED_DISPATCH: 'forged-dispatch',
      CONDUCT_MANAGED_PROJECT: '/forged/project',
    });

    expect(env.CONDUCT_MANAGED_FEATURE).toBe('feature-a');
    expect(env.CONDUCT_MANAGED_DISPATCH).toBe('dispatch-1');
    expect(env.CONDUCT_MANAGED_PROJECT).toBe(await realpath(context.projectRoot));
    expect(JSON.parse(env.CONDUCT_MANAGED_SESSION_CONTEXT!)).toMatchObject({
      scope: { kind: 'feature', featureSlug: 'feature-a' },
      dispatchId: 'dispatch-1',
    });
  });

  it('rejects traversal and symlink producer escapes without accepting an outside path', async () => {
    const { root, context } = await fixture();
    const prepared = await prepareManagedSessionContext(context);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const outside = join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, join(prepared.context.producerRoot, 'escape'));

    await expect(validateManagedSessionProducerPath(prepared.context, '../outside/event.jsonl'))
      .resolves.toEqual({ ok: false, code: 'producer-path-outside-root' });
    await expect(validateManagedSessionProducerPath(prepared.context, 'escape/event.jsonl'))
      .resolves.toEqual({ ok: false, code: 'producer-path-outside-root' });
  });

  it('creates explicit project scope without manufacturing a feature from child cwd', async () => {
    const { context } = await fixture();
    const result = await prepareManagedSessionContext({
      ...context,
      scope: { kind: 'project' },
      daemonFeature: false,
    });

    expect(result).toMatchObject({
      ok: true,
      context: { scope: { kind: 'project' }, dispatchId: 'dispatch-1' },
    });
    if (result.ok) expect(composeManagedSessionEnvironment(result.context).CONDUCT_MANAGED_FEATURE).toBeUndefined();
  });
});

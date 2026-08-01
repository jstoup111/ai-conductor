import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearProviderLifecycleEpisode,
  createProviderLifecycleEpisodeStore,
  readProviderLifecycleEpisode,
  writeProviderLifecycleEpisode,
} from '../../src/engine/provider-lifecycle-store.js';
import type { ProviderLifecycleEpisodeStoreFileOperations } from '../../src/engine/provider-lifecycle-store.js';
import type { ProviderLifecycleState } from '../../src/engine/provider-lifecycle.js';

const temporaryDirectories: string[] = [];

async function createProjectRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'provider-lifecycle-store-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('provider lifecycle episode store', () => {
  it('denies fresh recovery authority for malformed current lifecycle evidence', async () => {
    const projectRoot = await createProjectRoot();
    const pipelineDirectory = join(projectRoot, '.pipeline');

    await mkdir(pipelineDirectory);
    await writeFile(join(pipelineDirectory, 'provider-lifecycle-build.json'), '{ not json');

    await expect(readProviderLifecycleEpisode(projectRoot, 'build')).resolves.toEqual({
      recoveryAuthority: 'denied',
      reason: 'malformed-json',
    });
  });

  it('denies fresh recovery authority for unreadable current lifecycle evidence', async () => {
    const projectRoot = await createProjectRoot();
    const pipelineDirectory = join(projectRoot, '.pipeline');

    await mkdir(join(pipelineDirectory, 'provider-lifecycle-build.json'), { recursive: true });

    await expect(readProviderLifecycleEpisode(projectRoot, 'build')).resolves.toEqual({
      recoveryAuthority: 'denied',
      reason: 'unreadable',
    });
  });

  it('denies fresh recovery authority for an unsupported lifecycle evidence version', async () => {
    const projectRoot = await createProjectRoot();
    const pipelineDirectory = join(projectRoot, '.pipeline');

    await mkdir(pipelineDirectory);
    await writeFile(join(pipelineDirectory, 'provider-lifecycle-build.json'), JSON.stringify({
      version: 2,
      lifecycle: {
        phase: 'preparing',
        attempt: { logicalStep: 'build', id: 'build-attempt-1' },
        recoveryCount: 0,
      },
    }));

    await expect(readProviderLifecycleEpisode(projectRoot, 'build')).resolves.toEqual({
      recoveryAuthority: 'denied',
      reason: 'unknown-version',
    });
  });

  it('denies fresh recovery authority for lifecycle evidence with an unknown state', async () => {
    const projectRoot = await createProjectRoot();
    const pipelineDirectory = join(projectRoot, '.pipeline');

    await mkdir(pipelineDirectory);
    await writeFile(join(pipelineDirectory, 'provider-lifecycle-build.json'), JSON.stringify({
      version: 1,
      lifecycle: {
        phase: 'launching',
        attempt: { logicalStep: 'build', id: 'build-attempt-1' },
        recoveryCount: 0,
      },
    }));

    await expect(readProviderLifecycleEpisode(projectRoot, 'build')).resolves.toEqual({
      recoveryAuthority: 'denied',
      reason: 'unknown-state',
    });
  });

  it('denies fresh recovery authority for impossible lifecycle recovery counts', async () => {
    const projectRoot = await createProjectRoot();
    const pipelineDirectory = join(projectRoot, '.pipeline');

    await mkdir(pipelineDirectory);
    await writeFile(join(pipelineDirectory, 'provider-lifecycle-build.json'), JSON.stringify({
      version: 1,
      lifecycle: {
        phase: 'preparing',
        attempt: { logicalStep: 'build', id: 'build-attempt-1' },
        recoveryCount: 2,
      },
    }));

    await expect(readProviderLifecycleEpisode(projectRoot, 'build')).resolves.toEqual({
      recoveryAuthority: 'denied',
      reason: 'impossible-recovery-count',
    });
  });

  it('ignores interrupted temporary lifecycle files when no current evidence exists', async () => {
    const projectRoot = await createProjectRoot();
    const pipelineDirectory = join(projectRoot, '.pipeline');

    await mkdir(pipelineDirectory);
    await writeFile(join(pipelineDirectory, '.provider-lifecycle-build.interrupted.tmp'), '{ not json');

    await expect(readProviderLifecycleEpisode(projectRoot, 'build')).resolves.toEqual({
      recoveryAuthority: 'fresh',
    });
  });

  it('returns no episode when the logical step has no persisted lifecycle', async () => {
    const projectRoot = await createProjectRoot();

    expect(await readProviderLifecycleEpisode(projectRoot, 'build')).toEqual({ recoveryAuthority: 'fresh' });
  });

  it('round-trips the current lifecycle state for a logical step', async () => {
    const projectRoot = await createProjectRoot();
    const lifecycle: ProviderLifecycleState = {
      phase: 'preparing',
      attempt: { logicalStep: 'build', id: 'build-attempt-1' },
      recoveryCount: 0,
    };

    await writeProviderLifecycleEpisode(projectRoot, lifecycle);

    expect(await readProviderLifecycleEpisode(projectRoot, 'build')).toEqual({
      recoveryAuthority: 'persisted',
      lifecycle,
    });
  });

  it('reloads the consumed recovery count for a replacement after a daemon restart', async () => {
    const projectRoot = await createProjectRoot();
    const recoveringReplacement: ProviderLifecycleState = {
      phase: 'recovering',
      attempt: { logicalStep: 'build', id: 'build-attempt-1' },
      recoveryCount: 1,
      reason: 'preparation-timeout',
    };

    await writeProviderLifecycleEpisode(projectRoot, recoveringReplacement);

    expect(await readProviderLifecycleEpisode(projectRoot, 'build')).toEqual({
      recoveryAuthority: 'persisted',
      lifecycle: recoveringReplacement,
    });
  });

  it('replaces a logical step lifecycle with the newer completed attempt', async () => {
    const projectRoot = await createProjectRoot();
    const firstAttempt: ProviderLifecycleState = {
      phase: 'preparing',
      attempt: { logicalStep: 'build', id: 'build-attempt-1' },
      recoveryCount: 0,
    };
    const completedReplacement: ProviderLifecycleState = {
      phase: 'settled',
      attempt: { logicalStep: 'build', id: 'build-attempt-2' },
      recoveryCount: 1,
      outcome: 'completed',
    };

    await writeProviderLifecycleEpisode(projectRoot, firstAttempt);
    await writeProviderLifecycleEpisode(projectRoot, completedReplacement);

    expect(await readProviderLifecycleEpisode(projectRoot, 'build')).toEqual({
      recoveryAuthority: 'persisted',
      lifecycle: completedReplacement,
    });
  });

  it('writes a lifecycle record to a temporary file before atomically renaming it', async () => {
    const projectRoot = await createProjectRoot();
    const lifecycle: ProviderLifecycleState = {
      phase: 'preparing',
      attempt: { logicalStep: 'build', id: 'build-attempt-1' },
      recoveryCount: 0,
    };
    const calls: Array<{
      operation: 'mkdir' | 'writeFile' | 'rename';
      path?: string;
      from?: string;
      to?: string;
    }> = [];
    const fileOperations: ProviderLifecycleEpisodeStoreFileOperations = {
      mkdir: async (path) => {
        calls.push({ operation: 'mkdir', path });
      },
      readFile: async () => '',
      writeFile: async (path) => {
        calls.push({ operation: 'writeFile', path });
      },
      rename: async (from, to) => {
        calls.push({ operation: 'rename', from, to });
      },
      rm: async () => undefined,
    };
    const store = createProviderLifecycleEpisodeStore(fileOperations);
    const pipelineDirectory = join(projectRoot, '.pipeline');

    await store.writeProviderLifecycleEpisode(projectRoot, lifecycle);

    expect(calls).toMatchObject([
      { operation: 'mkdir', path: pipelineDirectory },
      { operation: 'writeFile' },
      {
        operation: 'rename',
        to: join(pipelineDirectory, 'provider-lifecycle-build.json'),
      },
    ]);
    expect(calls[1]?.path).toContain('.tmp');
    expect(calls[2]?.from).toBe(calls[1]?.path);
  });

  it('awaits temporary lifecycle cleanup before rejecting a failed rename', async () => {
    const projectRoot = await createProjectRoot();
    const lifecycle: ProviderLifecycleState = {
      phase: 'preparing',
      attempt: { logicalStep: 'build', id: 'build-attempt-1' },
      recoveryCount: 0,
    };
    const renameFailure = new Error('rename failed');
    let resolveRenameAttempt: (() => void) | undefined;
    const renameAttempted = new Promise<void>((resolve) => {
      resolveRenameAttempt = resolve;
    });
    let resolveCleanup: (() => void) | undefined;
    const cleanupReleased = new Promise<void>((resolve) => {
      resolveCleanup = resolve;
    });
    let cleanupStarted = false;
    let settled = false;
    const store = createProviderLifecycleEpisodeStore({
      mkdir: async () => undefined,
      readFile: async () => '',
      writeFile: async () => undefined,
      rename: async () => {
        resolveRenameAttempt?.();
        throw renameFailure;
      },
      rm: async () => {
        cleanupStarted = true;
        await cleanupReleased;
      },
    });

    const persistence = store.writeProviderLifecycleEpisode(projectRoot, lifecycle);
    void persistence.catch(() => {
      settled = true;
    });

    await renameAttempted;
    await Promise.resolve();

    expect(cleanupStarted).toBe(true);
    expect(settled).toBe(false);

    resolveCleanup?.();

    await expect(persistence).rejects.toBe(renameFailure);
  });

  it('removes a lifecycle episode after its completed settlement', async () => {
    const projectRoot = await createProjectRoot();
    const lifecycle: ProviderLifecycleState = {
      phase: 'settled',
      attempt: { logicalStep: 'build', id: 'build-attempt-1' },
      recoveryCount: 0,
      outcome: 'completed',
    };

    await writeProviderLifecycleEpisode(projectRoot, lifecycle);
    await clearProviderLifecycleEpisode(projectRoot, 'build');

    expect(await readProviderLifecycleEpisode(projectRoot, 'build')).toEqual({ recoveryAuthority: 'fresh' });
  });

  it('keeps lifecycle episodes independent for each logical step', async () => {
    const projectRoot = await createProjectRoot();
    const buildLifecycle: ProviderLifecycleState = {
      phase: 'preparing',
      attempt: { logicalStep: 'build', id: 'build-attempt-1' },
      recoveryCount: 0,
    };
    const reviewLifecycle: ProviderLifecycleState = {
      phase: 'recovering',
      attempt: { logicalStep: 'build_review', id: 'review-attempt-1' },
      recoveryCount: 1,
      reason: 'preparation-timeout',
    };

    await writeProviderLifecycleEpisode(projectRoot, buildLifecycle);
    await writeProviderLifecycleEpisode(projectRoot, reviewLifecycle);

    expect(await Promise.all([
      readProviderLifecycleEpisode(projectRoot, 'build'),
      readProviderLifecycleEpisode(projectRoot, 'build_review'),
    ])).toEqual([
      { recoveryAuthority: 'persisted', lifecycle: buildLifecycle },
      { recoveryAuthority: 'persisted', lifecycle: reviewLifecycle },
    ]);
  });
});

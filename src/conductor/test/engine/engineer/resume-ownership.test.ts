// Covers: task:14
import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { checkpointComposerRun } from '../../../src/engine/engineer/checkpoint.js';
import { resumeOwnershipMode } from '../../../src/engine/engineer/resume.js';
import { checkpointPublicationOwner, dispatchEngineer } from '../../../src/engine/engineer-cli.js';
import { decideSpecGate } from '../../../src/engine/owner-gate/gate.js';

describe('resume ownership', () => {
  it('Covers: Task 14 requires an interactive approved takeover and otherwise remains local-only', () => {
    expect(
      resumeOwnershipMode({
        committedOwner: 'A',
        machineOwner: 'B',
        interactive: true,
        daemonSession: false,
        approved: true,
      }),
    ).toBe('taken-over');
    expect(
      resumeOwnershipMode({ committedOwner: 'A', machineOwner: 'B', interactive: false, daemonSession: false }),
    ).toBe('local-only');
    expect(
      resumeOwnershipMode({
        committedOwner: 'A',
        machineOwner: 'B',
        interactive: true,
        daemonSession: true,
        approved: true,
      }),
    ).toBe('local-only');
  });

  it('Covers: Task 14 refuses unresolved ownership and never grants takeover to declined, non-TTY, or daemon sessions', () => {
    expect(() => resumeOwnershipMode({ committedOwner: 'A', daemonSession: false, interactive: true })).toThrow(
      /identity is unresolved/,
    );
    expect(
      resumeOwnershipMode({
        committedOwner: 'A',
        machineOwner: 'B',
        interactive: true,
        daemonSession: false,
        approved: false,
      }),
    ).toBe('local-only');
    expect(
      resumeOwnershipMode({
        committedOwner: 'A',
        machineOwner: 'B',
        interactive: false,
        daemonSession: false,
        approved: true,
      }),
    ).toBe('local-only');
    expect(
      resumeOwnershipMode({
        committedOwner: 'A',
        machineOwner: 'B',
        interactive: true,
        daemonSession: true,
        approved: true,
      }),
    ).toBe('local-only');
  });

  it('Covers: Task 14 keeps declined and non-TTY ownership retries local-only after their checkpoint already committed', async () => {
    for (const ownership of [
      { interactive: true, approved: false },
      { interactive: false, approved: true },
    ]) {
      expect(resumeOwnershipMode({ committedOwner: 'A', machineOwner: 'B', daemonSession: false, ...ownership })).toBe(
        'local-only',
      );
      const files = new Map<string, string>([
        ['.docs/intake/demo.md', 'Owner: A\n'],
        ['.docs/track/demo.md', '# demo\n'],
      ]);
      let dirty = true;
      const git = vi.fn(async (args: readonly string[]) => {
        if (args[0] === 'branch') return { exitCode: 0, stdout: 'spec/demo\n', stderr: '' };
        if (args[0] === 'status') return { exitCode: 0, stdout: dirty ? '?? .docs/track/demo.md' : '', stderr: '' };
        if (args[0] === 'diff') return { exitCode: 1, stdout: '', stderr: '' };
        return { exitCode: 0, stdout: '', stderr: '' };
      });
      const push = vi.fn(async () => {});
      const create = vi.fn(async () => ({ url: 'https://github.com/acme/demo/pull/8', body: '' }));
      const writeMarker = vi.fn(async () => {});
      const deps = {
        git,
        resolveOwner: async () => ({ resolved: true as const, id: 'B' }),
        fs: {
          readFile: async (path: string) => {
            const value = files.get(path.replace('/worktree/', ''));
            if (value === undefined) throw new Error(`ENOENT ${path}`);
            return value;
          },
          writeFile: async (path: string, value: string) => {
            files.set(path.replace('/worktree/', ''), value);
          },
          mkdir: async () => {},
        },
        writeMarker,
        emit: async () => {},
        localOnly: true,
        localOnlyOwner: 'A',
        publication: { push, findOpenPullRequest: async () => undefined, createDraftPullRequest: create },
      };

      await checkpointComposerRun({ worktree: '/worktree', step: 'explore', state: 'accepted' }, deps);
      dirty = false;
      const retry = await checkpointComposerRun({ worktree: '/worktree', step: 'explore', state: 'accepted' }, deps);

      expect(git.mock.calls.filter(([args]) => args[0] === 'commit')).toHaveLength(1);
      expect(push).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(writeMarker).not.toHaveBeenCalled();
      expect(files.get('.docs/intake/demo.md')).toContain('Owner: A');
      expect(retry).toMatchObject({
        committed: false,
        published: false,
        warnings: [expect.stringMatching(/owned by A.*stays local until interactive take-over/i)],
      });
    }
  });

  it('Covers: Task 14 re-approves take-over after a failed push when remote ownership remains foreign', () => {
    // The failed first push leaves B's local re-stamp durable, while fetched
    // origin still records A. Resume must use A again so the same guarded
    // approval/push path is retried instead of silently treating local B as
    // ownership authority.
    const ownerAfterFailedPush = checkpointPublicationOwner({ localMarkerOwner: 'B', remoteMarkerOwner: 'A' });
    expect(ownerAfterFailedPush).toBe('A');
    expect(
      resumeOwnershipMode({
        committedOwner: ownerAfterFailedPush,
        machineOwner: 'B',
        interactive: true,
        daemonSession: false,
        approved: true,
      }),
    ).toBe('taken-over');
    expect(checkpointPublicationOwner({ localMarkerOwner: 'B', remoteMarkerOwner: 'B' })).toBe('B');
  });

  it('Covers: Task 14 retries the guarded take-over push after its first transport failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'composer-takeover-retry-'));
    const registryPath = join(root, 'registry.json');
    const slug = 'demo';
    const branch = `spec/${slug}`;
    const confirmation = { mode: 'interactive' as const, confirm: vi.fn(async () => true) };
    let pushAttempts = 0;
    try {
      await execa('git', ['init', '-b', 'main', root]);
      await execa('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: root });
      await mkdir(join(root, '.docs', 'intake'), { recursive: true });
      await mkdir(join(root, '.docs', 'composer-runs'), { recursive: true });
      await writeFile(join(root, 'README.md'), '# fixture\n');
      await writeFile(join(root, '.docs', 'intake', `${slug}.md`), 'Source-Ref: acme/demo#12\nOwner: A\n');
      await writeFile(
        join(root, '.docs', 'composer-runs', `${slug}.json`),
        JSON.stringify({
          schemaVersion: 1,
          slug,
          track: 'technical',
          steps: { explore: { state: 'draft' } },
          needsReconfirm: [],
          ownerHistory: [],
          notes: {},
        }),
      );
      await execa('git', ['add', '.'], { cwd: root });
      await execa('git', ['commit', '-m', 'foreign run'], { cwd: root });
      await execa('git', ['branch', branch], { cwd: root });
      await writeFile(
        registryPath,
        JSON.stringify([
          {
            schemaVersion: 1,
            name: 'project',
            path: root,
            remote: 'https://github.com/acme/demo.git',
            status: 'registered',
            registeredAt: '2026-11-20T00:00:00.000Z',
          },
        ]),
      );
      const head = (await execa('git', ['rev-parse', branch], { cwd: root })).stdout;
      const git = async (args: string[], options?: { cwd?: string }) => {
        if (args[0] === 'fetch' || args[0] === 'log') return { stdout: '', exitCode: 0 };
        if (args[0] === 'remote' && args[1] === 'get-url')
          return { stdout: 'https://github.com/acme/demo.git\n', exitCode: 0 };
        if (args[0] === 'show' && args[1] === `origin/${branch}:.docs/intake/${slug}.md`)
          return { stdout: 'Source-Ref: acme/demo#12\nOwner: A\n', exitCode: 0 };
        if (args[0] === 'merge-base' || (args[0] === 'rev-parse' && args[1] === `origin/${branch}`))
          return { stdout: `${head}\n`, exitCode: 0 };
        if (args[0] === 'push') {
          pushAttempts += 1;
          if (pushAttempts === 1) throw new Error('transport unavailable');
          return { stdout: '', exitCode: 0 };
        }
        const result = await execa('git', args, { cwd: options?.cwd ?? root, reject: false });
        return { stdout: result.stdout, exitCode: result.exitCode ?? 0 };
      };
      const options = {
        registryPath,
        env: {},
        git,
        gh: async () => ({ stdout: '{}', stderr: '', exitCode: 0 }),
        resolveResumeOwner: async () => ({ resolved: true as const, id: 'B' }),
        confirmComposerTakeover: async () => true,
        githubOperationConfirmation: confirmation,
        chooseComposerLocalState: async () => 'keep-local' as const,
        isAttachedTerminal: () => true,
        providerInstalled: async () => true,
        spawnHost: async () => 0,
        print: () => {},
        printErr: () => {},
        probeGhVersion: async () => ({ kind: 'ok' as const, version: { major: 2, minor: 73, patch: 0 } }),
      };

      await expect(
        dispatchEngineer({ kind: 'resume', target: branch, project: 'project', provider: 'codex' }, options),
      ).resolves.toBe(0);
      await expect(
        dispatchEngineer({ kind: 'resume', target: branch, project: 'project', provider: 'codex' }, options),
      ).resolves.toBe(0);

      expect(pushAttempts).toBe(2);
      expect(confirmation.confirm).toHaveBeenCalledTimes(2);
      const worktree = join(root, '.worktrees', `engineer-${slug}`);
      await expect(readFile(join(worktree, '.docs', 'intake', `${slug}.md`), 'utf8')).resolves.toContain('Owner: B');
      const takeOverCommits = await execa('git', ['log', '--format=%s', `${head}..HEAD`], { cwd: worktree });
      expect(
        takeOverCommits.stdout.split('\n').filter((message) => message.startsWith('composer take-over:')),
      ).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('Covers: Task 14 leaves a foreign run local-only when the exact take-over push approval is refused', async () => {
    const root = await mkdtemp(join(tmpdir(), 'composer-takeover-refused-'));
    const registryPath = join(root, 'registry.json');
    const slug = 'demo';
    const branch = `spec/${slug}`;
    const confirmation = { mode: 'interactive' as const, confirm: vi.fn(async () => false) };
    const pushes: string[][] = [];
    const errors: string[] = [];
    try {
      await execa('git', ['init', '-b', 'main', root]);
      await execa('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: root });
      await mkdir(join(root, '.docs', 'intake'), { recursive: true });
      await mkdir(join(root, '.docs', 'composer-runs'), { recursive: true });
      await writeFile(join(root, 'README.md'), '# fixture\n');
      await writeFile(join(root, '.docs', 'intake', `${slug}.md`), 'Source-Ref: acme/demo#12\nOwner: A\n');
      await writeFile(
        join(root, '.docs', 'composer-runs', `${slug}.json`),
        JSON.stringify({
          schemaVersion: 1,
          slug,
          track: 'technical',
          steps: { explore: { state: 'draft' } },
          needsReconfirm: [],
          ownerHistory: [],
          notes: {},
        }),
      );
      await execa('git', ['add', '.'], { cwd: root });
      await execa('git', ['commit', '-m', 'foreign run'], { cwd: root });
      await execa('git', ['branch', branch], { cwd: root });
      await writeFile(
        registryPath,
        JSON.stringify([
          {
            schemaVersion: 1,
            name: 'project',
            path: root,
            remote: 'https://github.com/acme/demo.git',
            status: 'registered',
            registeredAt: '2026-11-20T00:00:00.000Z',
          },
        ]),
      );
      const head = (await execa('git', ['rev-parse', branch], { cwd: root })).stdout;
      const git = async (args: string[], options?: { cwd?: string }) => {
        if (args[0] === 'fetch' || args[0] === 'log') return { stdout: '', exitCode: 0 };
        if (args[0] === 'merge-base' || (args[0] === 'rev-parse' && args[1] === `origin/${branch}`))
          return { stdout: `${head}\n`, exitCode: 0 };
        if (args[0] === 'push') {
          pushes.push(args);
          return { stdout: '', exitCode: 0 };
        }
        const result = await execa('git', args, { cwd: options?.cwd ?? root, reject: false });
        return { stdout: result.stdout, exitCode: result.exitCode ?? 0 };
      };
      const code = await dispatchEngineer(
        { kind: 'resume', target: branch, project: 'project', provider: 'codex' },
        {
          registryPath,
          env: {},
          git,
          gh: async () => ({ stdout: '{}', stderr: '', exitCode: 0 }),
          resolveResumeOwner: async () => ({ resolved: true, id: 'B' }),
          confirmComposerTakeover: async () => true,
          githubOperationConfirmation: confirmation,
          isAttachedTerminal: () => true,
          providerInstalled: async () => true,
          spawnHost: async (_executable, _argv, worktree) => {
            await rm(join(worktree, '.docs', 'composer-runs', `${slug}.json`));
            return 0;
          },
          print: () => {},
          printErr: (line) => errors.push(line),
          probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
        },
      );
      expect(code).toBe(0);
      expect(confirmation.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'remote-ref.push',
          target: { repository: 'acme/demo', kind: 'remote-ref', ref: `refs/heads/${branch}` },
        }),
      );
      expect(pushes).toEqual([]);
      const worktree = join(root, '.worktrees', `engineer-${slug}`);
      await expect(readFile(join(worktree, '.docs', 'intake', `${slug}.md`), 'utf8')).resolves.toContain('Owner: A');
      expect(errors.join('\n')).toMatch(/owner and this run stays local until interactive take-over/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('Covers: Task 14 gates the re-stamped owner branch to that daemon owner only', () => {
    const stamp = { present: true as const, id: 'B' };
    expect(decideSpecGate({ daemonOwner: { id: 'B' }, stamp, mergeTime: null, cutover: null })).toEqual({
      build: true,
    });
    expect(decideSpecGate({ daemonOwner: { id: 'A' }, stamp, mergeTime: null, cutover: null })).toEqual({
      build: false,
      reason: 'other-owner',
      other: 'B',
    });
  });
});

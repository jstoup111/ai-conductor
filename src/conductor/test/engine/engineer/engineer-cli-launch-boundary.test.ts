// Covers: task:16
// Covers: task:17
import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { resolveBoundaryProvider } from '../../../src/engine/engineer/launch-boundary.js';
import { dispatchEngineer } from '../../../src/engine/engineer-cli.js';

describe('Composer launcher boundary', () => {
  it('Covers: Task 17 continues, switches only to an interactive provider, and refuses local-only handoff', () => {
    expect(resolveBoundaryProvider({ choice: 'continue', activeProvider: 'claude', hasRemote: true })).toEqual({
      action: 'resume',
      provider: 'claude',
    });
    expect(
      resolveBoundaryProvider({ choice: 'switch', activeProvider: 'claude', switchTo: 'codex', hasRemote: true }),
    ).toEqual({ action: 'resume', provider: 'codex' });
    expect(() => resolveBoundaryProvider({ choice: 'handoff', activeProvider: 'codex', hasRemote: false })).toThrow(
      /only locally/,
    );
  });

  it('Covers: Task 17 refuses a switch without an interactive provider before it can mutate a run', () => {
    expect(() =>
      resolveBoundaryProvider({ choice: 'switch', activeProvider: 'claude', switchTo: undefined, hasRemote: true }),
    ).toThrow(/interactiveLaunch capability/);
  });

  it('Covers: Task 17 treats handoff as a remote-only terminal choice while continue preserves the active provider', () => {
    expect(resolveBoundaryProvider({ choice: 'continue', activeProvider: 'codex', hasRemote: true })).toEqual({
      action: 'resume',
      provider: 'codex',
    });
    expect(resolveBoundaryProvider({ choice: 'handoff', activeProvider: 'codex', hasRemote: true })).toEqual({
      action: 'handoff',
    });
  });

  it('Covers: Task 16 gives a launcher-started Composer host one stable launch id and provider identity', async () => {
    const spawn = vi.fn(async (_executable: string, _argv: string[], _cwd: string, _env: NodeJS.ProcessEnv) => 0);
    const code = await dispatchEngineer(
      { kind: 'launch', provider: 'codex' },
      {
        spawnHost: spawn,
        print: () => {},
        printErr: () => {},
        isAttachedTerminal: () => true,
        loadLaunchConfig: async () => ({ ok: true, config: {}, warnings: [] }),
        prePoll: async () => 0,
        confirmAnother: async () => false,
        env: {},
        probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
      },
    );
    expect(code).toBe(0);
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn.mock.calls[0][3]).toMatchObject({
      AI_CONDUCTOR_AUTHORING_PROVIDER: 'codex',
      AI_CONDUCTOR_COMPOSE_LAUNCH_ID: expect.any(String),
    });
  });

  it('Covers: Task 16 persists the launcher correlation id on the run-start event ledger', async () => {
    const root = await mkdtemp(join(tmpdir(), 'composer-launch-event-'));
    const project = join(root, 'project');
    const registryPath = join(root, 'registry.json');
    try {
      await execa('git', ['init', '-b', 'main', project]);
      await execa('git', ['config', 'user.email', 'test@example.test'], { cwd: project });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: project });
      await writeFile(join(project, 'README.md'), '# fixture\n');
      await execa('git', ['add', 'README.md'], { cwd: project });
      await execa('git', ['commit', '-m', 'fixture'], { cwd: project });
      await writeFile(
        registryPath,
        JSON.stringify([
          {
            schemaVersion: 1,
            name: 'project',
            path: project,
            status: 'registered',
            registeredAt: '2026-11-10T00:00:00.000Z',
          },
        ]),
      );

      const code = await dispatchEngineer(
        { kind: 'worktree', project: 'project', idea: 'record launcher event' },
        {
          registryPath,
          env: { AI_CONDUCTOR_COMPOSE_LAUNCH_ID: 'launch-16', AI_CONDUCTOR_AUTHORING_PROVIDER: 'codex' },
          print: () => {},
          printErr: () => {},
          resolveCheckpointOwner: async () => ({ resolved: true, id: 'operator-a' }),
          probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
        },
      );

      expect(code).toBe(0);
      const events = (await readFile(join(project, '.pipeline', 'composer-events.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'composer_run_started',
          slug: 'record-launcher-event',
          launchId: 'launch-16',
          provider: 'codex',
          worktreePath: join(project, '.worktrees', 'engineer-record-launcher-event'),
        }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('Covers: Tasks 16, 17, and 3 reloads the switched child record before checkpointing its first unaccepted step', async () => {
    const root = await mkdtemp(join(tmpdir(), 'composer-launch-exit-'));
    const project = join(root, 'project');
    const registryPath = join(root, 'registry.json');
    const slug = 'switched-child';
    const recordPath = join(project, '.docs', 'composer-runs', `${slug}.json`);
    const initialRecord = {
      schemaVersion: 1,
      slug,
      track: 'technical',
      steps: { explore: { state: 'draft' } },
      needsReconfirm: [],
      ownerHistory: [],
      notes: {},
    };
    const childRecord = {
      ...initialRecord,
      steps: {
        explore: {
          state: 'accepted',
          actor: 'operator-a',
          provider: 'codex',
          at: '2026-11-15T00:00:00.000Z',
          artifacts: [],
        },
        complexity: { state: 'draft' },
      },
      lastCheckpoint: { actor: 'operator-a', provider: 'codex', at: '2026-11-15T00:00:00.000Z' },
    };
    try {
      await execa('git', ['init', '-b', 'main', project]);
      await execa('git', ['config', 'user.email', 'test@example.test'], { cwd: project });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: project });
      await writeFile(join(project, 'README.md'), '# fixture\n');
      await execa('git', ['add', 'README.md'], { cwd: project });
      await execa('git', ['commit', '-m', 'fixture'], { cwd: project });
      await mkdir(join(project, '.docs', 'composer-runs'), { recursive: true });
      await mkdir(join(project, '.pipeline'), { recursive: true });
      await mkdir(join(project, '.worktrees'), { recursive: true });
      await writeFile(recordPath, `${JSON.stringify(initialRecord)}\n`);
      await writeFile(
        join(project, '.pipeline', 'composer-events.jsonl'),
        `${JSON.stringify({
          type: 'composer_run_started',
          slug,
          worktreePath: project,
          launchId: 'launch-16',
          provider: 'claude',
        })}\n`,
      );
      await writeFile(
        registryPath,
        JSON.stringify([
          {
            schemaVersion: 1,
            name: 'project',
            path: project,
            status: 'registered',
            registeredAt: '2026-11-10T00:00:00.000Z',
          },
        ]),
      );

      const checkpoint = vi.fn(
        async (request: { worktree: string; step: string; state: 'accepted' | 'draft'; provider?: string }) => {
          const status = await execa('git', ['status', '--porcelain', '--', '.docs'], { cwd: request.worktree });
          if (status.stdout.trim()) {
            await execa('git', ['add', '--', '.docs'], { cwd: request.worktree });
            await execa('git', ['commit', '-m', 'checkpoint fixture'], { cwd: request.worktree });
          }
          return { slug, state: request.state, committed: status.stdout.trim().length > 0, published: true };
        },
      );
      const git = async (args: string[], options?: { cwd?: string }) => {
        const result = await execa('git', args, { cwd: options?.cwd, reject: false });
        return { stdout: result.stdout, exitCode: result.exitCode ?? 0 };
      };
      const spawnHost = vi.fn(async (executable: string) => {
        if (executable === 'codex') await writeFile(recordPath, `${JSON.stringify(childRecord)}\n`);
        return 0;
      });
      let attached = true;
      const code = await dispatchEngineer(
        { kind: 'launch', provider: 'claude', idea: 'switch providers' },
        {
          registryPath,
          env: { AI_CONDUCTOR_COMPOSE_LAUNCH_ID: 'launch-16' },
          spawnHost,
          checkpoint,
          git,
          gh: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
          print: () => {},
          printErr: () => {},
          isAttachedTerminal: () => attached,
          loadLaunchConfig: async () => ({ ok: true, config: {}, warnings: [] }),
          prePoll: async () => 0,
          confirmAnother: async () => false,
          providerInstalled: async () => true,
          chooseComposerBoundary: vi
            .fn()
            .mockResolvedValueOnce({ choice: 'switch', switchTo: 'codex' })
            .mockImplementationOnce(async () => {
              attached = false;
              return { choice: 'handoff' };
            }),
          probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
        },
      );

      expect(code).toBe(0);
      expect(spawnHost.mock.calls.map(([executable]) => executable)).toEqual(['claude', 'codex']);
      expect(
        checkpoint.mock.calls.map(([request]) => ({
          step: request.step,
          state: request.state,
          provider: request.provider,
        })),
      ).toEqual([
        { step: 'explore', state: 'draft', provider: 'claude' },
        { step: 'complexity', state: 'draft', provider: 'codex' },
      ]);
      expect(JSON.parse(await readFile(recordPath, 'utf8')).steps).toMatchObject({
        explore: { state: 'accepted', provider: 'codex' },
        complexity: { state: 'draft' },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('Covers: Task 16 checkpoints the reloaded first unaccepted step after a direct resume host exits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'composer-resume-exit-'));
    const project = join(root, 'project');
    const registryPath = join(root, 'registry.json');
    const slug = 'direct-resume';
    const initialRecord = {
      schemaVersion: 1,
      slug,
      track: 'technical',
      steps: { explore: { state: 'draft' } },
      needsReconfirm: [],
      ownerHistory: [],
      notes: {},
    };
    const childRecord = {
      ...initialRecord,
      steps: {
        explore: {
          state: 'accepted',
          actor: 'operator-a',
          provider: 'codex',
          at: '2026-11-15T00:00:00.000Z',
          artifacts: [],
        },
        complexity: { state: 'draft' },
      },
      lastCheckpoint: { actor: 'operator-a', provider: 'codex', at: '2026-11-15T00:00:00.000Z' },
    };
    try {
      await execa('git', ['init', '-b', 'main', project]);
      await execa('git', ['config', 'user.email', 'test@example.test'], { cwd: project });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: project });
      await mkdir(join(project, '.docs', 'composer-runs'), { recursive: true });
      await mkdir(join(project, '.pipeline'), { recursive: true });
      await mkdir(join(project, '.worktrees'), { recursive: true });
      await writeFile(join(project, 'README.md'), '# fixture\n');
      await writeFile(join(project, '.docs', 'composer-runs', `${slug}.json`), `${JSON.stringify(initialRecord)}\n`);
      await execa('git', ['add', 'README.md', '.docs'], { cwd: project });
      await execa('git', ['commit', '-m', 'fixture'], { cwd: project });
      await execa('git', ['branch', `spec/${slug}`], { cwd: project });
      await writeFile(
        registryPath,
        JSON.stringify([
          {
            schemaVersion: 1,
            name: 'project',
            path: project,
            status: 'registered',
            registeredAt: '2026-11-10T00:00:00.000Z',
          },
        ]),
      );

      const checkpoint = vi.fn(
        async (request: { worktree: string; step: string; state: 'accepted' | 'draft'; provider?: string }) => {
          const status = await execa('git', ['status', '--porcelain', '--', '.docs'], { cwd: request.worktree });
          if (status.stdout.trim()) {
            await execa('git', ['add', '--', '.docs'], { cwd: request.worktree });
            await execa('git', ['commit', '-m', 'checkpoint fixture'], { cwd: request.worktree });
          }
          return {
            slug,
            state: request.state,
            committed: status.stdout.trim().length > 0,
            published: true,
          };
        },
      );
      const git = async (args: string[], options?: { cwd?: string }) => {
        const result = await execa('git', args, { cwd: options?.cwd, reject: false });
        return { stdout: result.stdout, exitCode: result.exitCode ?? 0 };
      };
      const spawnHost = vi.fn(async (_executable: string, _argv: string[], worktree: string) => {
        await writeFile(join(worktree, '.docs', 'composer-runs', `${slug}.json`), `${JSON.stringify(childRecord)}\n`);
        return 0;
      });
      const print = vi.fn();
      let attached = true;
      const code = await dispatchEngineer(
        { kind: 'resume', target: `spec/${slug}`, project: 'project', provider: 'codex' },
        {
          registryPath,
          env: {},
          spawnHost,
          checkpoint,
          git,
          print,
          printErr: () => {},
          isAttachedTerminal: () => attached,
          providerInstalled: async () => true,
          chooseComposerBoundary: vi
            .fn()
            .mockResolvedValueOnce({ choice: 'continue' })
            .mockImplementationOnce(async () => {
              attached = false;
              return { choice: 'handoff' };
            }),
          resolveResumeOwner: async () => ({ resolved: true, id: 'operator-a' }),
          probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
        },
      );

      expect(code).toBe(0);
      expect(spawnHost).toHaveBeenCalledTimes(2);
      expect(
        checkpoint.mock.calls.map(([request]) => ({
          step: request.step,
          state: request.state,
          provider: request.provider,
        })),
      ).toEqual([{ step: 'complexity', state: 'draft', provider: 'codex' }]);
      expect(print.mock.calls.flat().join('\n')).toMatch(
        /current step complexity; active provider codex[\s\S]*current step complexity; active provider codex/,
      );
      expect(print.mock.calls.flat().join('\n')).not.toMatch(/handed off/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

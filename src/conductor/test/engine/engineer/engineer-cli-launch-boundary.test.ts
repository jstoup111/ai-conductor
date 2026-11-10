// Covers: task:16
// Covers: task:17
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { resolveBoundaryProvider } from '../../../src/engine/engineer/launch-boundary.js';
import { dispatchEngineer } from '../../../src/engine/engineer-cli.js';

describe('Composer launcher boundary', () => {
  it('Covers: Task 17 continues, switches only to an interactive provider, and refuses local-only handoff', () => {
    expect(resolveBoundaryProvider({ choice: 'continue', activeProvider: 'claude', hasRemote: true })).toEqual({ action: 'resume', provider: 'claude' });
    expect(resolveBoundaryProvider({ choice: 'switch', activeProvider: 'claude', switchTo: 'codex', hasRemote: true })).toEqual({ action: 'resume', provider: 'codex' });
    expect(() => resolveBoundaryProvider({ choice: 'handoff', activeProvider: 'codex', hasRemote: false })).toThrow(/only locally/);
  });

  it('Covers: Task 17 refuses a switch without an interactive provider before it can mutate a run', () => {
    expect(() => resolveBoundaryProvider({ choice: 'switch', activeProvider: 'claude', switchTo: undefined, hasRemote: true })).toThrow(/interactiveLaunch capability/);
  });

  it('Covers: Task 17 treats handoff as a remote-only terminal choice while continue preserves the active provider', () => {
    expect(resolveBoundaryProvider({ choice: 'continue', activeProvider: 'codex', hasRemote: true })).toEqual({ action: 'resume', provider: 'codex' });
    expect(resolveBoundaryProvider({ choice: 'handoff', activeProvider: 'codex', hasRemote: true })).toEqual({ action: 'handoff' });
  });

  it('Covers: Task 16 gives a launcher-started Composer host one stable launch id and provider identity', async () => {
    const spawn = vi.fn(async (_executable: string, _argv: string[], _cwd: string, _env: NodeJS.ProcessEnv) => 0);
    const code = await dispatchEngineer({ kind: 'launch', provider: 'codex' }, {
      spawnHost: spawn,
      print: () => {}, printErr: () => {}, isAttachedTerminal: () => true,
      loadLaunchConfig: async () => ({ ok: true, config: {}, warnings: [] }),
      prePoll: async () => 0, confirmAnother: async () => false, env: {},
      probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
    });
    expect(code).toBe(0);
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn.mock.calls[0][3]).toMatchObject({ AI_CONDUCTOR_AUTHORING_PROVIDER: 'codex', AI_CONDUCTOR_COMPOSE_LAUNCH_ID: expect.any(String) });
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
      await writeFile(registryPath, JSON.stringify([{ schemaVersion: 1, name: 'project', path: project, status: 'registered', registeredAt: '2026-11-10T00:00:00.000Z' }]));

      const code = await dispatchEngineer({ kind: 'worktree', project: 'project', idea: 'record launcher event' }, {
        registryPath,
        env: { AI_CONDUCTOR_COMPOSE_LAUNCH_ID: 'launch-16', AI_CONDUCTOR_AUTHORING_PROVIDER: 'codex' },
        print: () => {}, printErr: () => {},
        resolveCheckpointOwner: async () => ({ resolved: true, id: 'operator-a' }),
        probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
      });

      expect(code).toBe(0);
      const events = (await readFile(join(project, '.pipeline', 'composer-events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        type: 'composer_run_started', slug: 'record-launcher-event',
        launchId: 'launch-16', provider: 'codex',
        worktreePath: join(project, '.worktrees', 'engineer-record-launcher-event'),
      }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

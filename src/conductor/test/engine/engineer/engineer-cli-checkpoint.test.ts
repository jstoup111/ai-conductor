// Covers: task:3
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectEngineerCommand, dispatchEngineer } from '../../../src/engine/engineer-cli.js';

const argv = (...args: string[]) => ['node', 'ai-conductor', 'compose', ...args];

describe('compose checkpoint CLI', () => {
  it('Covers: Task 3 parses --worktree, --step, exactly one state flag, and optional notes file', () => {
    expect(
      detectEngineerCommand(
        argv('checkpoint', '--worktree', '/w', '--step', 'explore', '--accept', '--notes-file', '/notes.json'),
      ),
    ).toEqual({ kind: 'checkpoint', worktree: '/w', step: 'explore', state: 'accepted', notesFile: '/notes.json' });
    expect(
      detectEngineerCommand(argv('checkpoint', '--worktree', '/w', '--step', 'explore', '--accept', '--draft')),
    ).toEqual({ kind: 'guide' });
  });

  it('Covers: Task 3 dispatches checkpoint through its injected boundary and reports local checkpoint success', async () => {
    const checkpoint = vi.fn(async () => ({
      slug: 'demo',
      state: 'accepted' as const,
      committed: true,
      published: false,
    }));
    const output: string[] = [];
    const code = await dispatchEngineer(
      { kind: 'checkpoint', worktree: '/w', step: 'explore', state: 'accepted' },
      {
        checkpoint,
        print: (line) => output.push(line),
        probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
      },
    );
    expect(code).toBe(0);
    expect(checkpoint).toHaveBeenCalledWith(
      expect.objectContaining({ worktree: '/w', step: 'explore', state: 'accepted' }),
    );
    expect(output).toContain(
      JSON.stringify({ kind: 'checkpoint', slug: 'demo', state: 'accepted', committed: true, published: false }),
    );
  });

  it('Covers: Task 3 persists composer_run_checkpointed before compose checkpoint --accept resolves', async () => {
    const root = await mkdtemp(join(tmpdir(), 'engineer-cli-checkpoint-event-'));
    const registryPath = join(root, 'registry.json');
    try {
      await mkdir(join(root, '.docs', 'track'), { recursive: true });
      await writeFile(join(root, '.docs', 'track', 'demo.md'), '# Track\n\nTrack: technical\n');
      await writeFile(
        registryPath,
        JSON.stringify([
          {
            schemaVersion: 1,
            name: 'demo',
            path: root,
            status: 'registered',
            registeredAt: '2026-11-20T00:00:00.000Z',
          },
        ]),
      );
      const git = vi.fn(async (args: string[]) => {
        if (args[0] === 'branch') return { stdout: 'spec/demo\n', stderr: '', exitCode: 0 };
        if (args[0] === 'status') return { stdout: ' M .docs/track/demo.md\n', stderr: '', exitCode: 0 };
        if (args[0] === 'diff') return { stdout: '.docs/track/demo.md\n', stderr: '', exitCode: 0 };
        return { stdout: '', stderr: '', exitCode: 0 };
      });

      await expect(
        dispatchEngineer(
          { kind: 'checkpoint', worktree: root, step: 'explore', state: 'accepted' },
          {
            registryPath,
            git,
            resolveCheckpointOwner: async () => ({ resolved: true, id: 'owner' }),
            print: () => {},
            printErr: () => {},
            probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
          },
        ),
      ).resolves.toBe(0);

      const ledger = (await readFile(join(root, '.pipeline', 'composer-events.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(ledger).toEqual([expect.objectContaining({ type: 'composer_run_checkpointed', slug: 'demo' })]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

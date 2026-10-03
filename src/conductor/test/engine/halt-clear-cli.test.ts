import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import { detectHaltClearCommand } from '../../src/cli.js';
import { dispatchHaltClearCommand } from '../../src/engine/halt-clear-cli.js';

const roots: string[] = [];

async function fixture(haltClass = 'needs-human') {
  const root = await mkdtemp(join(tmpdir(), 'halt-clear-cli-'));
  roots.push(root);
  const slug = 'halted-feature';
  const worktree = join(root, '.worktrees', slug);
  await mkdir(join(worktree, '.pipeline'), { recursive: true });
  await writeFile(join(worktree, '.pipeline', 'HALT'), 'Await operator decision.\n');
  await writeFile(join(worktree, '.pipeline', 'HALT.class'), haltClass);
  await writeFile(join(worktree, '.pipeline', 'conduct-state.json'), '{"last_step":"build"}\n');
  await mkdir(join(worktree, '.docs', 'halted'), { recursive: true });
  await writeFile(join(worktree, '.docs', 'halted', `${slug}.md`), 'Status: halted\nSlug: halted-feature\n');
  await execa('git', ['init', '--initial-branch=feature'], { cwd: worktree });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: worktree });
  await execa('git', ['config', 'user.email', 'test@example.test'], { cwd: worktree });
  await execa('git', ['add', '.'], { cwd: worktree });
  await execa('git', ['commit', '-m', 'fixture'], { cwd: worktree });
  return { root, slug, worktree };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('halt clear CLI', () => {
  it('clears an interactive needs-human halt, audits it first, and resolves its record', async () => {
    const { root, slug, worktree } = await fixture();
    const statePath = join(worktree, '.pipeline', 'conduct-state.json');
    const beforeState = await readFile(statePath);
    const command = detectHaltClearCommand([
      'node', 'ai-conductor', 'halt', 'clear', '--feature', slug, '--rationale', '  plan amended and resealed  ',
    ]);
    expect(command).toEqual({ kind: 'halt-clear', feature: slug, rationale: '  plan amended and resealed  ' });
    let sawMarkersAtAppend = false;

    expect(await dispatchHaltClearCommand(command!, {
      cwd: root,
      resolveMainRoot: async () => root,
      resolveOperator: () => 'op',
      isInteractive: () => true,
      appendEvent: async () => {
        sawMarkersAtAppend = await Promise.all([
          access(join(worktree, '.pipeline', 'HALT')),
          access(join(worktree, '.pipeline', 'HALT.class')),
        ]).then(() => true);
      },
      print: () => {},
    })).toBe(0);

    await expect(access(join(worktree, '.pipeline', 'HALT'))).rejects.toThrow();
    await expect(access(join(worktree, '.pipeline', 'HALT.class'))).rejects.toThrow();
    expect(await readFile(statePath)).toEqual(beforeState);
    expect(sawMarkersAtAppend).toBe(true);
    const events = (await readFile(join(worktree, '.pipeline', 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    expect(events).toEqual([expect.objectContaining({
      type: 'halt_clear_authorized', feature: slug, operator: 'op', rationale: 'plan amended and resealed', haltClass: 'needs-human',
    })]);
    await expect(readFile(join(worktree, '.docs', 'halted', `${slug}.md`), 'utf8')).resolves.toContain('Status: resolved\nResolution cause: operator\n');
  });

  it.each(['kickback-cap', 'plan-gap', 'over-scope', 'protected-artifact'])('preserves %s in the authorization event', async (haltClass) => {
    const { root, slug, worktree } = await fixture(haltClass);
    const command = detectHaltClearCommand(['node', 'ai-conductor', 'halt', 'clear', '--feature', slug, '--rationale', 'resolved']);
    expect(await dispatchHaltClearCommand(command!, {
      cwd: root, resolveMainRoot: async () => root, resolveOperator: () => 'op', isInteractive: () => true, print: () => {},
    })).toBe(0);
    const [event] = (await readFile(join(worktree, '.pipeline', 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    expect(event.haltClass).toBe(haltClass);
  });
});

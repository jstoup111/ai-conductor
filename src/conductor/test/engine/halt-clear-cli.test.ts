import { afterEach, describe, expect, it } from 'vitest';
// Covers: task:2, task:3
import { access, mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import { detectHaltClearCommand } from '../../src/cli.js';
import { MAX_OPERATOR_RATIONALE_BYTES } from '../../src/engine/cli-operator-authority.js';
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

async function refusalState(worktree: string) {
  const pipeline = join(worktree, '.pipeline');
  const read = (name: string) => readFile(join(pipeline, name)).catch(() => undefined);
  return { halt: await read('HALT'), haltClass: await read('HALT.class'), events: await read('events.jsonl') };
}

async function expectRefusalStateUnchanged(worktree: string, before: Awaited<ReturnType<typeof refusalState>>) {
  await expect(refusalState(worktree)).resolves.toEqual(before);
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

  it('refuses a feature that is not halted without authorizing a clear', async () => {
    const { root, slug, worktree } = await fixture();
    await unlink(join(worktree, '.pipeline', 'HALT'));
    const before = await refusalState(worktree);
    const out: string[] = [];
    const command = detectHaltClearCommand(['node', 'ai-conductor', 'halt', 'clear', '--feature', slug, '--rationale', 'resolved']);

    expect(await dispatchHaltClearCommand(command!, {
      cwd: root, resolveMainRoot: async () => root, resolveOperator: () => 'op', isInteractive: () => true, print: (line) => out.push(line),
    })).not.toBe(0);

    expect(out.join('\n')).toContain('not halted');
    await expectRefusalStateUnchanged(worktree, before);
  });

  it.each([
    ['missing', undefined],
    ['whitespace-only', '   '],
    ['over the byte bound', 'x'.repeat(MAX_OPERATOR_RATIONALE_BYTES + 1)],
  ])('refuses a %s rationale without changing halt state', async (_caseName, rationale) => {
    const { root, slug, worktree } = await fixture();
    const before = await refusalState(worktree);
    const out: string[] = [];
    const args = ['node', 'ai-conductor', 'halt', 'clear', '--feature', slug] as string[];
    if (rationale !== undefined) args.push('--rationale', rationale);
    const command = detectHaltClearCommand(args);
    expect(command).not.toBeNull();

    expect(await dispatchHaltClearCommand(command!, {
      cwd: root, resolveMainRoot: async () => root, resolveOperator: () => 'op', isInteractive: () => true, print: (line) => out.push(line),
    })).not.toBe(0);

    expect(out.join('\n')).toContain('invalid rationale');
    await expectRefusalStateUnchanged(worktree, before);
  });

  it('refuses a non-interactive clear without changing halt state', async () => {
    const { root, slug, worktree } = await fixture();
    const before = await refusalState(worktree);
    const out: string[] = [];
    const command = detectHaltClearCommand(['node', 'ai-conductor', 'halt', 'clear', '--feature', slug, '--rationale', 'resolved']);

    expect(await dispatchHaltClearCommand(command!, {
      cwd: root, resolveMainRoot: async () => root, resolveOperator: () => 'op', isInteractive: () => false, print: (line) => out.push(line),
    })).not.toBe(0);

    expect(out.join('\n')).toContain('interactive local operator terminal');
    await expectRefusalStateUnchanged(worktree, before);
  });

  it('refuses an unresolved operator identity without changing halt state', async () => {
    const { root, slug, worktree } = await fixture();
    const before = await refusalState(worktree);
    const out: string[] = [];
    const command = detectHaltClearCommand(['node', 'ai-conductor', 'halt', 'clear', '--feature', slug, '--rationale', 'resolved']);

    expect(await dispatchHaltClearCommand(command!, {
      cwd: root, resolveMainRoot: async () => root, resolveOperator: () => undefined, isInteractive: () => true, print: (line) => out.push(line),
    })).not.toBe(0);

    expect(out.join('\n')).toContain('no approved operator identity');
    await expectRefusalStateUnchanged(worktree, before);
  });

  it('refuses an unavailable feature without writing under the main root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'halt-clear-cli-'));
    roots.push(root);
    const before = await readdir(root);
    const out: string[] = [];
    const command = detectHaltClearCommand(['node', 'ai-conductor', 'halt', 'clear', '--feature', 'unknown-feature', '--rationale', 'resolved']);

    expect(await dispatchHaltClearCommand(command!, {
      cwd: root, resolveMainRoot: async () => root, resolveOperator: () => 'op', isInteractive: () => true, print: (line) => out.push(line),
    })).not.toBe(0);

    expect(out.join('\n')).toContain("feature 'unknown-feature' is unavailable");
    await expect(readdir(root)).resolves.toEqual(before);
  });
});

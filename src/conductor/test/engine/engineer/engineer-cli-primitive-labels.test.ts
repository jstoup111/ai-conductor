// Covers: task:5
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { detectEngineerCommand, dispatchEngineer } from '../../../src/engine/engineer-cli.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<{ registryPath: string; worktree: string }> {
  const root = await mkdtemp(join(tmpdir(), 'engineer-cli-primitive-labels-'));
  roots.push(root);
  const worktree = join(root, 'worktree');
  await execa('git', ['init', '--initial-branch=main', worktree]);
  await execa('git', ['config', 'user.email', 'test@example.test'], { cwd: worktree });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: worktree });
  await execa('git', ['commit', '--allow-empty', '-m', 'initial'], { cwd: worktree });
  await execa('git', ['checkout', '-b', 'spec/demo-idea'], { cwd: worktree });
  const registryPath = join(root, 'registry.json');
  await writeFile(registryPath, '[]\n');
  return { registryPath, worktree };
}

const argv = (...args: string[]) => ['node', 'conduct', 'compose', ...args];
const ghCapability = { probeGhVersion: async () => ({ kind: 'ok' as const }) };
const herdrEnvironment = { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' };

function primitiveCommand(kind: 'plan-review' | 'land' | 'handoff', worktree: string) {
  if (kind === 'plan-review') return detectEngineerCommand(argv(kind, '--project', 'missing', '--worktree', worktree))!;
  if (kind === 'land') return detectEngineerCommand(argv(kind, '--project', 'missing', '--idea', 'Demo idea', '--worktree', worktree))!;
  return detectEngineerCommand(argv(kind, '--project', 'missing', '--branch', 'spec/demo-idea', '--worktree', worktree))!;
}

describe('compose primitive pane labels', () => {
  it.each(['plan-review', 'land', 'handoff'] as const)(
    'labels the pane as %s before its registry lookup',
    async (kind) => {
      const { registryPath, worktree } = await fixture();
      const calls: Array<{ command: string; args: string[] }> = [];

      const code = await dispatchEngineer(primitiveCommand(kind, worktree), {
        ...ghCapability,
        registryPath,
        env: herdrEnvironment,
        paneLabelRunner: async (command, args) => { calls.push({ command, args }); },
      });

      expect(code).toBe(1);
      expect(calls).toEqual([
        { command: 'herdr', args: ['pane', 'rename', 'w1:p1', `demo-idea · ${kind}`] },
      ]);
    },
  );

  it.each(['plan-review', 'land', 'handoff'] as const)(
    'preserves unknown-project output and exit code for %s when labeling',
    async (kind) => {
      const { registryPath, worktree } = await fixture();
      const labeledOutput: string[] = [];
      const labeledErrors: string[] = [];
      const plainOutput: string[] = [];
      const plainErrors: string[] = [];
      const command = primitiveCommand(kind, worktree);

      const labeled = await dispatchEngineer(command, {
        ...ghCapability,
        registryPath,
        env: herdrEnvironment,
        paneLabelRunner: async () => {},
        print: (line) => labeledOutput.push(line),
        printErr: (line) => labeledErrors.push(line),
      });
      const plain = await dispatchEngineer(command, {
        ...ghCapability,
        registryPath,
        print: (line) => plainOutput.push(line),
        printErr: (line) => plainErrors.push(line),
      });

      expect(labeled).toBe(plain);
      expect(labeledOutput).toEqual(plainOutput);
      expect(labeledErrors).toEqual(plainErrors);
    },
  );

  it('relabels land after a skipped phase call and lets a following phase replace that label', async () => {
    const { registryPath, worktree } = await fixture();
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner = async (command: string, args: string[]) => { calls.push({ command, args }); };
    const phaseStories = detectEngineerCommand(argv('phase', '--worktree', worktree, '--phase', 'stories'))!;
    const phasePlan = detectEngineerCommand(argv('phase', '--worktree', worktree, '--phase', 'plan'))!;
    const land = primitiveCommand('land', worktree);
    const labeledOutput: string[] = [];
    const plainOutput: string[] = [];

    expect(await dispatchEngineer(phaseStories, { ...ghCapability, env: herdrEnvironment, paneLabelRunner: runner })).toBe(0);
    expect(await dispatchEngineer(phaseStories, { ...ghCapability, env: {}, paneLabelRunner: runner })).toBe(0);
    const labeledLand = await dispatchEngineer(land, {
      ...ghCapability, registryPath, env: herdrEnvironment, paneLabelRunner: runner,
      print: (line) => labeledOutput.push(line),
    });
    const plainLand = await dispatchEngineer(land, {
      ...ghCapability, registryPath, print: (line) => plainOutput.push(line),
    });
    const planned = await dispatchEngineer(phasePlan, { ...ghCapability, env: herdrEnvironment, paneLabelRunner: runner });

    expect(labeledLand).toBe(plainLand);
    expect(labeledOutput).toEqual(plainOutput);
    expect(planned).toBe(0);
    expect(calls).toEqual([
      { command: 'herdr', args: ['pane', 'rename', 'w1:p1', 'demo-idea · stories'] },
      { command: 'herdr', args: ['pane', 'rename', 'w1:p1', 'demo-idea · land'] },
      { command: 'herdr', args: ['pane', 'rename', 'w1:p1', 'demo-idea · plan'] },
    ]);
  });
});

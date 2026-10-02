// Covers: task:3, task:4
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { materializePiHarnessExtension } from '../../src/execution/pi-harness-extension.js';
import { createFakeExtensionApi, loadExtensionFactory, type FakeToolDefinition } from './support/fake-pi-extension-api.js';

type ExecFileCallback = (error: (Error & { code?: number }) | null, stdout: string, stderr: string) => void;
type ExecFileCall = { file: string; args: string[]; options: { cwd?: string; shell?: unknown; env?: Record<string, string | undefined> } };

/**
 * Process boundary: the asset reaches child_process through process.getBuiltinModule (it may
 * not import). Every other builtin passes through to the real runtime.
 */
const boundary = vi.hoisted(() => ({
  calls: [] as Array<{ file: string; args: string[]; options: any }>,
  reply: { error: null as any, stdout: '', stderr: '' },
}));
const realGetBuiltinModule = process.getBuiltinModule.bind(process);

describe('harness extension git_read', () => {
  let home: string;
  let factory: Awaited<ReturnType<typeof loadExtensionFactory>>;
  let gitRead: FakeToolDefinition;

  const run = (params: unknown) => gitRead.execute('call-1', params, undefined, undefined, { cwd: home });

  beforeEach(async () => {
    boundary.calls.length = 0;
    boundary.reply = { error: null, stdout: 'git stdout', stderr: '' };
    vi.spyOn(process, 'getBuiltinModule').mockImplementation(((id: string) => {
      if (id !== 'node:child_process') return realGetBuiltinModule(id as never);
      return {
        execFile: (file: string, args: string[], options: ExecFileCall['options'], callback: ExecFileCallback) => {
          boundary.calls.push({ file, args, options });
          callback(boundary.reply.error, boundary.reply.stdout, boundary.reply.stderr);
        },
      };
    }) as typeof process.getBuiltinModule);
    home = await mkdtemp(join(tmpdir(), 'pi-git-read-'));
    factory = await loadExtensionFactory(await materializePiHarnessExtension({ homeDir: home }));
    const fake = createFakeExtensionApi({ 'conduct-git-read': true });
    await factory(fake.api);
    expect(fake.tools).toHaveLength(1);
    gitRead = fake.tools[0]!;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(home, { recursive: true, force: true });
  });

  it('registers exactly one git_read tool with the closed subcommand enum', () => {
    expect(gitRead.name).toBe('git_read');
    expect((gitRead.parameters as any).properties.subcommand.enum).toEqual([
      'show', 'diff', 'log', 'ls-tree', 'ls-files', 'cat-file', 'rev-parse', 'blame', 'grep',
    ]);
    expect((gitRead.parameters as any).properties.args).toEqual({ type: 'array', items: { type: 'string' } });
  });

  it('registers no git_read tool without its flag', async () => {
    const fake = createFakeExtensionApi();
    await factory(fake.api);
    expect(fake.tools).toEqual([]);
  });

  it('spawns git shell-free with the params argv byte-for-byte in ctx.cwd and returns stdout', async () => {
    const result = await run({ subcommand: 'diff', args: ['HEAD~1', '--', 'src/a.ts'] });

    expect(boundary.calls).toHaveLength(1);
    expect(boundary.calls[0]!.file).toBe('git');
    expect(boundary.calls[0]!.args).toEqual(['diff', 'HEAD~1', '--', 'src/a.ts']);
    expect(boundary.calls[0]!.options.shell).toBe(false);
    expect(boundary.calls[0]!.options.cwd).toBe(home);
    expect(result.content).toEqual([{ type: 'text', text: 'git stdout' }]);
  });

  it('sets the pager to cat and drops any external-diff variable', async () => {
    vi.stubEnv('GIT_EXTERNAL_DIFF', '/tmp/evil');
    vi.stubEnv('GIT_PAGER', 'less');
    try {
      await run({ subcommand: 'log', args: ['-1'] });
    } finally {
      vi.unstubAllEnvs();
    }

    const env = boundary.calls[0]!.options.env!;
    expect(env.GIT_PAGER).toBe('cat');
    expect(env.PAGER).toBe('cat');
    expect(Object.keys(env)).not.toContain('GIT_EXTERNAL_DIFF');
  });

  it('throws for a subcommand outside the allowlist and spawns nothing', async () => {
    await expect(run({ subcommand: 'commit', args: ['-m', 'x'] })).rejects.toThrow('git_read subcommand not allowed: commit');
    expect(boundary.calls).toEqual([]);
  });

  it.each([
    ['--output=/tmp/x', '--output'],
    ['--out=/tmp/x', '--output'],
    ['-O', '-O'],
    ['--open-files-in-pager=vi', '--open-files-in-pager'],
    ['--ext-diff', '--ext-diff'],
    ['--textconv', '--textconv'],
    ['--filters', '--filters'],
    ['--show-signature', '--show-signature'],
    ['--config-env=core.pager=X', '--config-env'],
  ])('throws naming refused option %s and spawns nothing', async (arg, named) => {
    await expect(run({ subcommand: 'show', args: ['HEAD', arg] })).rejects.toThrow(`git_read option not allowed: ${named}`);
    expect(boundary.calls).toEqual([]);
  });

  it('throws for -c core.pager=sh and spawns nothing', async () => {
    await expect(run({ subcommand: 'log', args: ['-c', 'core.pager=sh'] })).rejects.toThrow('git_read option not allowed: -c');
    expect(boundary.calls).toEqual([]);
  });

  it('passes a shell metacharacter arg as one literal argv element and removes nothing', async () => {
    const sentinel = join(home, 'sentinel');
    await writeFile(sentinel, 'keep');

    await run({ subcommand: 'show', args: ['HEAD; rm -rf .'] });

    expect(boundary.calls[0]!.args).toEqual(['show', 'HEAD; rm -rf .']);
    expect(boundary.calls[0]!.options.shell).toBe(false);
    expect(existsSync(sentinel)).toBe(true);
  });

  it('throws carrying git stderr when git exits non-zero', async () => {
    boundary.reply = { error: Object.assign(new Error('Command failed'), { code: 128 }), stdout: '', stderr: 'fatal: bad revision' };

    await expect(run({ subcommand: 'show', args: ['nope'] })).rejects.toThrow('fatal: bad revision');
  });
});

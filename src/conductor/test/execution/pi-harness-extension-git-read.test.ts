import { beforeEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';

const execFile = vi.fn();

vi.mock('node:child_process', () => ({ execFile }));

import { PI_HARNESS_EXTENSION_SOURCE } from '../../src/execution/pi-harness-extension.js';

type GitReadTool = {
  execute(args: { subcommand: string; args: string[] }, context: { cwd: string }): Promise<unknown>;
};

function registerGitReadTool(): GitReadTool {
  let tool: GitReadTool | undefined;
  const pi = {
    registerFlag: vi.fn((name: string) => name),
    getFlag: vi.fn((name: string) => name === 'conduct-git-read'),
    registerTool: vi.fn((candidate: { name: string }) => {
      if (candidate.name === 'git_read') tool = candidate as unknown as GitReadTool;
    }),
  };
  (globalThis as typeof globalThis & { piTestChildProcess?: { execFile: typeof execFile } }).piTestChildProcess = { execFile };
  const source = PI_HARNESS_EXTENSION_SOURCE
    .replace('export default function', 'return function')
    .replace("await import('node:child_process')", 'globalThis.piTestChildProcess');
  const extension = Function(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ESNext },
  }).outputText)() as (api: typeof pi) => void;
  extension(pi);
  if (!tool) throw new Error('git_read tool was not registered');
  return tool;
}

describe('Pi git_read option refusal', () => {
  let gitRead: GitReadTool;

  beforeEach(() => {
    vi.clearAllMocks();
    execFile.mockImplementation(((_file: string, _args: string[], _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void) => callback(null, 'safe output', '')) as never);
    gitRead = registerGitReadTool();
  });

  it.each([
    ['--output', '--output'],
    ['--output=/tmp/x', '--output'],
    ['-O', '-O'],
    ['--open-files-in-pager', '--open-files-in-pager'],
    ['--open-files-in-pager=vi', '--open-files-in-pager'],
    ['--ext-diff', '--ext-diff'],
    ['--textconv', '--textconv'],
    ['-c', '-c'],
    ['--config-env', '--config-env'],
    ['--config-env=core.pager=X', '--config-env'],
  ])('refuses the existing exact form %s', async (arg, deniedOption) => {
    await expect(gitRead.execute({ subcommand: 'show', args: [arg] }, { cwd: '/repo' }))
      .resolves.toMatchObject({ isError: true, content: [{ text: `option not allowed: ${deniedOption}` }] });
    expect(execFile).not.toHaveBeenCalled();
  });

  it.each([
    ['-Osh', '-O'],
    ['-iOcat', '-O'],
    ['--open-files-in-p=vi', '--open-files-in-pager'],
    ['--open=vi', '--open-files-in-pager'],
    ['--outp=/tmp/x', '--output'],
    ['--out=/tmp/x', '--output'],
    ['--ext-d', '--ext-diff'],
    ['--textc', '--textconv'],
    ['--config-e=core.pager=X', '--config-env'],
    ['-ccore.pager=sh', '-c'],
  ])('refuses abbreviated or bundled form %s before reaching execFile', async (arg, deniedOption) => {
    await expect(gitRead.execute({ subcommand: 'show', args: [arg] }, { cwd: '/repo' }))
      .resolves.toMatchObject({ isError: true, content: [{ text: `option not allowed: ${deniedOption}` }] });
    expect(execFile).not.toHaveBeenCalled();
  });

  it('passes a shell-looking argument literally to execFile', async () => {
    await expect(gitRead.execute({ subcommand: 'show', args: ['HEAD; rm -rf .'] }, { cwd: '/repo' }))
      .resolves.toMatchObject({ content: [{ text: 'safe output' }] });

    expect(execFile).toHaveBeenCalledWith('git', ['show', 'HEAD; rm -rf .'], expect.objectContaining({
      cwd: '/repo', shell: false,
    }), expect.any(Function));
  });
});

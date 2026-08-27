/**
 * Covers: S1.1, S1.2, S1.3, S1.4, task:1
 *
 * RED acceptance coverage for retiring the unattended inline --auto path.
 * The tests drive the real conduct-ts command and observe the complete
 * rejection boundary: terminal guidance, prompt-free exit, and absence of
 * pipeline/worktree/provider side effects.
 *
 * Provider executables are PATH-local tripwires. They make any unexpected
 * dispatch observable without permitting a real third-party call.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
// Invoke the current TypeScript entry point rather than bin/conduct-ts. The
// wrapper deliberately pins a previously published, gitignored dist bundle,
// which can be stale relative to the source behavior this acceptance test
// covers.
const CONDUCT_ENTRY_POINT = join(REPO_ROOT, 'src', 'conductor', 'src', 'index.ts');
const TSX_LOADER = join(REPO_ROOT, 'src', 'conductor', 'node_modules', 'tsx', 'dist', 'loader.mjs');

describe('acceptance: unattended inline --auto is rejected before pipeline setup', () => {
  let projectRoot: string;
  let fakeBin: string;
  let dispatchMarker: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'inline-auto-rejection-project-'));
    fakeBin = await mkdtemp(join(tmpdir(), 'inline-auto-rejection-bin-'));
    dispatchMarker = join(projectRoot, 'provider-dispatched');

    for (const provider of ['claude', 'codex']) {
      const executable = join(fakeBin, provider);
      await writeFile(
        executable,
        `#!/bin/sh\nprintf '%s\\n' dispatched > '${dispatchMarker}'\nexit 97\n`,
        'utf8',
      );
      await chmod(executable, 0o755);
    }

    const init = spawnSync('git', ['init', '-q', '-b', 'main'], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    if (init.status !== 0) {
      throw new Error(`git fixture initialization failed: ${init.stderr}`);
    }
  });

  afterEach(async () => {
    await Promise.all([
      rm(projectRoot, { recursive: true, force: true }),
      rm(fakeBin, { recursive: true, force: true }),
    ]);
  });

  function invoke(args: string[], stdin?: string) {
    const result = spawnSync(process.execPath, ['--import', TSX_LOADER, CONDUCT_ENTRY_POINT, ...args], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
        TMPDIR: projectRoot,
      },
      input: stdin,
      encoding: 'utf8',
      timeout: 10_000,
    });
    return {
      exitCode: result.status,
      signal: result.signal,
      stderr: result.stderr,
      pipelineCreated: existsSync(join(projectRoot, '.pipeline')),
      worktreesCreated: existsSync(join(projectRoot, '.worktrees')),
      providerDispatched: existsSync(dispatchMarker),
    };
  }

  it('names the daemon and guide while rejecting before state or provider setup', () => {
    const result = invoke(['inline', 'x', '--auto']);

    expect(result).toEqual({
      exitCode: 1,
      signal: null,
      stderr: expect.stringMatching(
        /--auto[\s\S]*conduct-ts daemon start[\s\S]*docs\/guides\/running-the-daemon\.md/i,
      ),
      pipelineCreated: false,
      worktreesCreated: false,
      providerDispatched: false,
    });
  });

  it('preserves mutual exclusion and rejects both flags before pipeline setup', () => {
    const result = invoke(['inline', 'x', '--auto', '--interactive']);

    expect(result).toEqual({
      exitCode: 1,
      signal: null,
      stderr: expect.stringMatching(/--auto[\s\S]*--interactive[\s\S]*mutually exclusive/i),
      pipelineCreated: false,
      worktreesCreated: false,
      providerDispatched: false,
    });
  });

  it('rejects headless stdin without prompting or dispatching', async () => {
    const result = invoke(['inline', 'x', '--auto'], '');

    expect(result).toEqual({
      exitCode: 1,
      signal: null,
      stderr: expect.stringMatching(/conduct-ts daemon start[\s\S]*running-the-daemon\.md/i),
      pipelineCreated: false,
      worktreesCreated: false,
      providerDispatched: false,
    });

    await expect(readFile(dispatchMarker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

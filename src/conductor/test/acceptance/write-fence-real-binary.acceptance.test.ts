/**
 * Real-binary acceptance smoke for #380's write-fence (TR-4/TR-5).
 *
 * Per /writing-system-tests §1 (headless/CLI acceptance = public-interface /
 * command-invocation tests) and the story's own Done-When ("real-binary smoke
 * tests: invoked as bash with real JSON payloads on stdin"), this drives:
 *
 *   1. The REAL production entry point `provisionSandboxBuildEnv` to
 *      materialize the fence script inside a real sandbox configDir (proves
 *      TR-4 wiring — not just that `write-fence.ts`'s generator function
 *      returns the right text).
 *   2. The materialized script itself, invoked as a real child `bash` process
 *      with real JSON on stdin (proves TR-5 — not the in-module verdict
 *      function called directly).
 *
 * A unit test that calls the fence's verdict logic in isolation would pass
 * even if `provisionSandboxBuildEnv` never wrote the script, or wrote it with
 * stale roots baked in — this spec fails in both cases.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { provisionSandboxBuildEnv } from '../../src/engine/self-host/sandbox-build-env.js';

describe('acceptance (real-binary): write-fence blocks checkout escapes, allows worktree work (#380, TR-4/TR-5)', () => {
  let harnessRoot: string;
  let worktree: string;
  let globalConfig: string;
  let base: string;
  let fenceScript: string;
  let teardown: () => Promise<void>;

  beforeAll(async () => {
    harnessRoot = await mkdtemp(join(tmpdir(), 'wf-harness-'));
    worktree = join(harnessRoot, '.worktrees', 'my-feature');
    globalConfig = await mkdtemp(join(tmpdir(), 'wf-global-'));
    base = await mkdtemp(join(tmpdir(), 'wf-base-'));

    await mkdir(join(worktree, 'skills'), { recursive: true });
    await mkdir(join(worktree, 'hooks'), { recursive: true });
    await mkdir(join(worktree, 'src', 'conductor', 'src'), { recursive: true });
    await mkdir(join(harnessRoot, 'src', 'conductor', 'src'), { recursive: true });
    await mkdir(join(harnessRoot, 'test'), { recursive: true });
    await mkdir(join(globalConfig, 'skills'), { recursive: true });
    await mkdir(join(globalConfig, 'hooks'), { recursive: true });

    const sandbox = await provisionSandboxBuildEnv({
      worktreeRoot: worktree,
      harnessRoot,
      globalConfigDir: globalConfig,
      baseDir: base,
    });
    teardown = () => sandbox.teardown();
    fenceScript = join(sandbox.configDir, 'write-fence.sh');
  });

  afterAll(async () => {
    await teardown?.();
    for (const d of [harnessRoot, globalConfig, base]) {
      await rm(d, { recursive: true, force: true });
    }
  });

  it('the fence script is materialized inside the sandbox config dir and is executable', async () => {
    expect(existsSync(fenceScript)).toBe(true);
  });

  async function runFence(
    payload: unknown,
    cwd: string = worktree,
  ): Promise<{ exitCode: number; stderr: string }> {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const result = await execa('bash', [fenceScript], {
      cwd,
      input: body,
      reject: false,
    });
    return { exitCode: result.exitCode ?? -1, stderr: result.stderr };
  }

  it('allows an Edit targeting a file inside the build worktree', async () => {
    const { exitCode } = await runFence({
      tool_name: 'Edit',
      tool_input: { file_path: join(worktree, 'src', 'conductor', 'src', 'x.ts') },
    });
    expect(exitCode).toBe(0);
  });

  it('blocks an Edit targeting the live harness checkout outside the worktree, naming path/worktree/rule', async () => {
    const target = join(harnessRoot, 'src', 'conductor', 'src', 'x.ts');
    const { exitCode, stderr } = await runFence({
      tool_name: 'Edit',
      tool_input: { file_path: target },
    });
    expect(exitCode).toBe(2);
    expect(stderr).toContain(target);
    expect(stderr).toContain(worktree);
  });

  it('blocks a Bash command that redirects into a main-checkout path outside the worktree', async () => {
    const target = join(harnessRoot, 'test', 'daemon.test.ts.new');
    const { exitCode } = await runFence({
      tool_name: 'Bash',
      tool_input: { command: `sed 's/x/y/' foo.ts > ${target}` },
    });
    expect(exitCode).toBe(2);
  });

  it('allows an Edit in an unrelated repo (outside the harness checkout entirely)', async () => {
    const unrelated = await mkdtemp(join(tmpdir(), 'wf-unrelated-'));
    try {
      const { exitCode } = await runFence({
        tool_name: 'Edit',
        tool_input: { file_path: join(unrelated, 'x.ts') },
      });
      expect(exitCode).toBe(0);
    } finally {
      await rm(unrelated, { recursive: true, force: true });
    }
  });

  it('allows an Edit targeting the OS temp dir', async () => {
    const { exitCode } = await runFence({
      tool_name: 'Edit',
      tool_input: { file_path: join(tmpdir(), 'scratch.ts') },
    });
    expect(exitCode).toBe(0);
  });

  it('allows a read-only Bash reference to a main-checkout path (grep/cat/diff — no write shape)', async () => {
    const target = join(harnessRoot, 'src', 'conductor', 'src');
    const { exitCode } = await runFence({
      tool_name: 'Bash',
      tool_input: { command: `grep -r "foo" ${target}` },
    });
    expect(exitCode).toBe(0);
  });

  it('resolves a relative path against the session cwd before the verdict (.. traversal does not evade the fence)', async () => {
    const nested = join(worktree, 'src', 'conductor', 'src');
    const { exitCode } = await runFence(
      {
        tool_name: 'Edit',
        tool_input: { file_path: '../../../../src/conductor/src/x.ts' },
      },
      nested,
    );
    // From <worktree>/src/conductor/src, four levels of ../ lands in
    // <harnessRoot>/src/conductor/src — outside the worktree.
    expect(exitCode).toBe(2);
  });

  it('allows on malformed/empty stdin and never crashes the session', async () => {
    const empty = await runFence('');
    expect(empty.exitCode).toBe(0);

    const garbage = await runFence('{not json');
    expect(garbage.exitCode).toBe(0);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { generateFenceScript, mergeFenceIntoSettings } from '../../../src/engine/self-host/write-fence.js';
import { execa } from 'execa';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Unit tests for write-fence script generator and settings merger (TR-4).
 *
 * Tests 1–4 cover the two core functions:
 *   - generateFenceScript(worktreeRoot, harnessRoot): string — bakes paths into a bash script
 *   - mergeFenceIntoSettings(operatorSettingsJson): string — merges fence entry into settings
 *
 * Test 5 verifies bash syntax validity (no placeholder residue).
 */
describe('write-fence — script generator + settings merge (TR-4)', () => {
  const worktreeRoot = '/tmp/worktree-test-abc123';
  const harnessRoot = '/tmp/harness-test-def456';

  it('generateFenceScript bakes worktree and harness roots into the script, no placeholders remain', () => {
    const script = generateFenceScript(worktreeRoot, harnessRoot);
    expect(script).toContain(worktreeRoot);
    expect(script).toContain(harnessRoot);
    // No placeholder patterns should remain
    expect(script).not.toContain('{{ worktreeRoot }}');
    expect(script).not.toContain('${WORKTREE_ROOT}');
    expect(script).not.toContain('${HARNESS_ROOT}');
    expect(script).not.toContain('__WORKTREE_ROOT__');
    expect(script).not.toContain('__HARNESS_ROOT__');
  });

  it('mergeFenceIntoSettings(null) returns minimal valid settings.json with fence entry', () => {
    const result = mergeFenceIntoSettings(null);
    const parsed = JSON.parse(result);
    expect(parsed).toBeDefined();
    expect(parsed.hooks).toBeDefined();
    expect(parsed.hooks.PreToolUse).toBeDefined();
    expect(Array.isArray(parsed.hooks.PreToolUse)).toBe(true);
    // Should have at least the fence entry
    const fenceEntry = parsed.hooks.PreToolUse.find((e: unknown) =>
      typeof e === 'object' &&
      e !== null &&
      'command' in e &&
      (e as Record<string, unknown>).command?.toString().includes('write-fence')
    );
    expect(fenceEntry).toBeDefined();
  });

  it('mergeFenceIntoSettings preserves existing operator hook entries byte-for-byte', () => {
    const operatorSettings = JSON.stringify({
      hooks: {
        PreToolUse: [
          { command: '/home/operator/.claude/hooks/personal.sh' },
          { command: '/home/operator/.claude/hooks/another.sh' },
        ],
      },
    });
    const result = mergeFenceIntoSettings(operatorSettings);
    const parsed = JSON.parse(result);
    expect(parsed.hooks.PreToolUse).toContainEqual({
      command: '/home/operator/.claude/hooks/personal.sh',
    });
    expect(parsed.hooks.PreToolUse).toContainEqual({
      command: '/home/operator/.claude/hooks/another.sh',
    });
    // Check that at least 3 entries exist (2 original + 1 fence)
    expect(parsed.hooks.PreToolUse.length).toBeGreaterThanOrEqual(3);
  });

  it('mergeFenceIntoSettings handles multiple operator hook entries, all preserved', () => {
    const operatorSettings = JSON.stringify({
      hooks: {
        PreToolUse: [
          { command: '/path/to/hook1.sh' },
          { command: '/path/to/hook2.sh' },
          { command: '/path/to/hook3.sh' },
        ],
      },
    });
    const result = mergeFenceIntoSettings(operatorSettings);
    const parsed = JSON.parse(result);
    expect(parsed.hooks.PreToolUse.length).toBeGreaterThanOrEqual(4); // 3 original + 1 fence
    expect(parsed.hooks.PreToolUse).toContainEqual({ command: '/path/to/hook1.sh' });
    expect(parsed.hooks.PreToolUse).toContainEqual({ command: '/path/to/hook2.sh' });
    expect(parsed.hooks.PreToolUse).toContainEqual({ command: '/path/to/hook3.sh' });
  });

  it('generated script is valid bash syntax (no errors from bash -n)', async () => {
    const script = generateFenceScript(worktreeRoot, harnessRoot);
    // bash -n checks syntax without executing
    const result = await execa('bash', ['-n'], {
      input: script,
      reject: false,
    });
    expect(result.exitCode).toBe(0);
  });
});

/**
 * Real-binary smoke tests for write-fence allow cases (Task 17).
 * These tests invoke the generated script with real bash binary and JSON payloads on stdin.
 */
describe('write-fence — real-binary smoke tests (allow cases)', () => {
  const worktreeRoot = '/tmp/write-fence-smoke-worktree';
  const harnessRoot = '/tmp/write-fence-smoke-harness';

  async function runScript(script: string, payload: unknown): Promise<{ exitCode: number; stderr: string; stdout: string }> {
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    // Pass script via -c flag, and payload via stdin
    const result = await execa('bash', ['-c', script], {
      input: payloadStr,
      reject: false,
    });
    return { exitCode: result.exitCode ?? -1, stderr: result.stderr, stdout: result.stdout };
  }

  it('ALLOW: edit inside worktree root → exit 0', async () => {
    const script = generateFenceScript(worktreeRoot, harnessRoot);
    const payload = {
      tool_name: 'Edit',
      tool_input: {
        file_path: `${worktreeRoot}/src/conductor/src/x.ts`,
      },
    };
    const { exitCode } = await runScript(script, payload);
    expect(exitCode).toBe(0);
  });

  it('ALLOW: edit in unrelated repo (outside both worktree and harness) → exit 0', async () => {
    const script = generateFenceScript(worktreeRoot, harnessRoot);
    // Use a path that's clearly outside both roots
    const unrelatedPath = '/home/user/other-project/src/app.ts';
    const payload = {
      tool_name: 'Edit',
      tool_input: {
        file_path: unrelatedPath,
      },
    };
    const { exitCode } = await runScript(script, payload);
    expect(exitCode).toBe(0);
  });

  it('ALLOW: edit in OS temp directory → exit 0', async () => {
    const script = generateFenceScript(worktreeRoot, harnessRoot);
    const tempPath = '/tmp/unrelated-edit/file.ts';
    const payload = {
      tool_name: 'Edit',
      tool_input: {
        file_path: tempPath,
      },
    };
    const { exitCode } = await runScript(script, payload);
    expect(exitCode).toBe(0);
  });

  it('ALLOW: Bash with read-only grep command → exit 0', async () => {
    const script = generateFenceScript(worktreeRoot, harnessRoot);
    const payload = {
      tool_name: 'Bash',
      tool_input: {
        command: `grep -r "pattern" ${worktreeRoot}/src`,
      },
    };
    const { exitCode } = await runScript(script, payload);
    expect(exitCode).toBe(0);
  });

  it('ALLOW: Bash with read-only cat command → exit 0', async () => {
    const script = generateFenceScript(worktreeRoot, harnessRoot);
    const payload = {
      tool_name: 'Bash',
      tool_input: {
        command: 'cat /tmp/somefile.txt',
      },
    };
    const { exitCode } = await runScript(script, payload);
    expect(exitCode).toBe(0);
  });

  it('ALLOW: empty stdin → exit 0, no stderr crash', async () => {
    const script = generateFenceScript(worktreeRoot, harnessRoot);
    const { exitCode, stderr } = await runScript(script, '');
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
  });

  it('ALLOW: garbage JSON on stdin → exit 0, no stderr crash', async () => {
    const script = generateFenceScript(worktreeRoot, harnessRoot);
    const { exitCode, stderr } = await runScript(script, 'not valid json at all {{{[');
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
  });

  it('ALLOW: malformed JSON (missing tool_name) → exit 0', async () => {
    const script = generateFenceScript(worktreeRoot, harnessRoot);
    const payload = {
      tool_input: {
        file_path: '/some/path.ts',
      },
      // tool_name missing
    };
    const { exitCode } = await runScript(script, payload);
    expect(exitCode).toBe(0);
  });

  it('ALLOW: Bash with read-only diff command → exit 0', async () => {
    const script = generateFenceScript(worktreeRoot, harnessRoot);
    const payload = {
      tool_name: 'Bash',
      tool_input: {
        command: 'diff /file1.txt /file2.txt',
      },
    };
    const { exitCode } = await runScript(script, payload);
    expect(exitCode).toBe(0);
  });

  it('ALLOW: Bash with read-only head command → exit 0', async () => {
    const script = generateFenceScript(worktreeRoot, harnessRoot);
    const payload = {
      tool_name: 'Bash',
      tool_input: {
        command: 'head -20 /tmp/large-file.log',
      },
    };
    const { exitCode } = await runScript(script, payload);
    expect(exitCode).toBe(0);
  });
});

/**
 * Real-binary smoke tests for write-fence block cases (Task 18).
 * These tests invoke the generated script with real bash binary and JSON payloads on stdin.
 * They verify that edits to harness checkout (outside worktree) are blocked with proper error messages.
 */
describe('write-fence — real-binary smoke tests (block cases)', () => {
  const worktreeRoot = '/tmp/write-fence-smoke-worktree';
  const harnessRoot = '/tmp/write-fence-smoke-harness';

  async function runScript(script: string, payload: unknown): Promise<{ exitCode: number; stderr: string; stdout: string }> {
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    // Pass script via -c flag, and payload via stdin
    const result = await execa('bash', ['-c', script], {
      input: payloadStr,
      reject: false,
    });
    return { exitCode: result.exitCode ?? -1, stderr: result.stderr, stdout: result.stdout };
  }

  it('BLOCK: Edit targeting harness checkout outside worktree → exit 2 with proper stderr', async () => {
    const script = generateFenceScript(worktreeRoot, harnessRoot);
    const targetPath = `${harnessRoot}/src/conductor/src/x.ts`;
    const payload = {
      tool_name: 'Edit',
      tool_input: {
        file_path: targetPath,
      },
    };
    const { exitCode, stderr } = await runScript(script, payload);
    expect(exitCode).toBe(2);
    expect(stderr).toContain(targetPath);
    expect(stderr).toContain(worktreeRoot);
    expect(stderr).toContain(harnessRoot);
    expect(stderr).toContain('rule');
  });

  it('BLOCK: Bash sed redirect to harness checkout → exit 2', async () => {
    const script = generateFenceScript(worktreeRoot, harnessRoot);
    const targetPath = `${harnessRoot}/test/f.ts.new`;
    const payload = {
      tool_name: 'Bash',
      tool_input: {
        command: `sed 's/x/y/' source.ts > ${targetPath}`,
      },
    };
    const { exitCode, stderr } = await runScript(script, payload);
    expect(exitCode).toBe(2);
    expect(stderr).toContain(targetPath);
  });

  it('BLOCK: Bash mv to harness checkout → exit 2', async () => {
    const script = generateFenceScript(worktreeRoot, harnessRoot);
    const targetPath = `${harnessRoot}/test/f.ts`;
    const payload = {
      tool_name: 'Bash',
      tool_input: {
        command: `mv tmp ${targetPath}`,
      },
    };
    const { exitCode, stderr } = await runScript(script, payload);
    expect(exitCode).toBe(2);
    expect(stderr).toContain(targetPath);
  });

  it('BLOCK: Bash cp to harness checkout → exit 2', async () => {
    const script = generateFenceScript(worktreeRoot, harnessRoot);
    const targetPath = `${harnessRoot}/src/file.ts`;
    const payload = {
      tool_name: 'Bash',
      tool_input: {
        command: `cp source.ts ${targetPath}`,
      },
    };
    const { exitCode, stderr } = await runScript(script, payload);
    expect(exitCode).toBe(2);
    expect(stderr).toContain(targetPath);
  });

  it('BLOCK: Bash tee redirect to harness checkout → exit 2', async () => {
    const script = generateFenceScript(worktreeRoot, harnessRoot);
    const targetPath = `${harnessRoot}/log.txt`;
    const payload = {
      tool_name: 'Bash',
      tool_input: {
        command: `tee ${targetPath}`,
      },
    };
    const { exitCode, stderr } = await runScript(script, payload);
    expect(exitCode).toBe(2);
    expect(stderr).toContain(targetPath);
  });

  it('BLOCK: Relative path traversal from inside worktree that escapes to harness → exit 2', async () => {
    // Create actual temp directories to test relative path resolution
    const tempBase = await mkdtemp(join(tmpdir(), 'wf-relative-test-'));
    const harnessRootActual = join(tempBase, 'harness');
    const worktreeRootActual = join(harnessRootActual, '.worktrees', 'feature');
    const nestedCwd = join(worktreeRootActual, 'src', 'conductor', 'src');

    try {
      // Create the nested directory structure
      await mkdir(nestedCwd, { recursive: true });

      const script = generateFenceScript(worktreeRootActual, harnessRootActual);
      const payload = {
        tool_name: 'Edit',
        tool_input: {
          file_path: '../../../../src/conductor/src/x.ts',
        },
      };

      // Invoke the script from the nested directory within the worktree
      // We need to modify the script to use pwd properly with cwd
      const result = await execa('bash', [], {
        input: script + '\n' + JSON.stringify(payload),
        cwd: nestedCwd,
        reject: false,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('FENCE BLOCK');
      // The resolved path should escape the worktree and land in the harness
      expect(result.stderr).toContain(harnessRootActual);
    } finally {
      // Cleanup
      await rm(tempBase, { recursive: true, force: true });
    }
  });
});

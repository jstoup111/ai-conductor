import { describe, it, expect } from 'vitest';
import { generateFenceScript, mergeFenceIntoSettings } from '../../../src/engine/self-host/write-fence.js';
import { execa } from 'execa';

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

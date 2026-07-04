import { describe, it, expect, afterEach } from 'vitest';
import { execa } from 'execa';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { detectsModelUnavailable } from '../../src/execution/claude-provider.js';

/**
 * Real-binary smoke test for TS-1 Done-When 3: prove the real Claude CLI's
 * model-unavailable error text actually matches MODEL_UNAVAILABLE_RE
 * (exported here as detectsModelUnavailable). Unit tests exercise the regex
 * against hand-authored strings; they cannot catch drift between the CLI's
 * actual wording and what we assume it says. This runs the real binary.
 *
 * Guarded: skipped when the `claude` binary isn't on PATH, or when the
 * MODEL_UNAVAILABLE_SMOKE=0 kill-switch is set (e.g. CI/offline).
 */
function claudeBinaryAvailable(): boolean {
  try {
    execFileSync('which', ['claude'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const killSwitchDisabled = process.env.MODEL_UNAVAILABLE_SMOKE === '0';
const shouldRun = claudeBinaryAvailable() && !killSwitchDisabled;

describe.skipIf(!shouldRun)('claude CLI model-unavailable signature (real binary)', () => {
  afterEach(() => {
    // Clean up any .pipeline state created by the Claude binary during the test.
    // The Claude CLI may write memory-tracking files to .pipeline/ in the cwd;
    // this guard ensures the test leaves no footprint for the global-setup guard
    // to detect as a leak.
    const pipelinePath = join(process.cwd(), '.pipeline');
    rmSync(pipelinePath, { recursive: true, force: true });
  });

  it(
    'matches MODEL_UNAVAILABLE_RE for a nonexistent --model value',
    async () => {
      const result = await execa(
        'claude',
        ['--model', 'definitely-not-a-model-xyz', '-p', 'ping', '--print'],
        { reject: false },
      );

      // Combine stdout + stderr, same as ClaudeProvider.invoke does.
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n');

      // Observed 2026-07-03 (real `claude` binary):
      //   "There's an issue with the selected model
      //    (definitely-not-a-model-xyz). It may not exist or you may not
      //    have access to it. Run --model to pick a different model."
      // This text did NOT match the original MODEL_UNAVAILABLE_RE (which
      // only covered API-error-shaped strings like "not_found_error" /
      // "model not found" / "invalid model") — this smoke caught that gap
      // and the regex was broadened in claude-provider.ts accordingly.
      expect(detectsModelUnavailable(output)).toBe(true);
    },
    30_000,
  );
});

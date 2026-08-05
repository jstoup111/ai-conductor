/**
 * RED acceptance specs for
 * `.docs/stories/daemon-e2e-smoke-step-has-no-real-agent-live-llm-t.md`.
 *
 * These specs verify the repository-level contract joining the opt-in smoke
 * test, its shared diagnostics, and its workflow. They do not launch a real
 * provider: that third-party boundary belongs exclusively to the smoke file.
 *
 * PRE-IMPLEMENTATION RED: the live smoke file and workflow do not exist, and
 * the deterministic fixture's diagnostics helper is private and omits the two
 * task-evidence artifacts.
 */

import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

const CONDUCTOR_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const REPO_ROOT = join(CONDUCTOR_ROOT, '..', '..');
const LIVE_SMOKE_PATH = join(
  CONDUCTOR_ROOT,
  'test/engine/daemon-e2e-live.smoke.test.ts',
);
const FIXTURE_PATH = join(
  CONDUCTOR_ROOT,
  'test/engine/daemon-e2e-fixture.test.ts',
);
const WORKFLOW_PATH = join(REPO_ROOT, '.github/workflows/live-daemon-e2e.yml');

async function requiredSource(path: string): Promise<string> {
  return readFile(path, 'utf8').catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`required live-tier artifact is not implemented: ${path}: ${detail}`);
  });
}

describe('live-agent daemon E2E tier (#1124)', () => {
  it('wires the real Claude provider through the daemon fixture and asserts outcomes, not agent choices', async () => {
    const source = await requiredSource(LIVE_SMOKE_PATH);

    expect(source).toMatch(/new\s+ClaudeProvider\s*\(/);
    expect(source).toMatch(/new\s+DefaultStepRunner\s*\(/);
    expect(source).toMatch(/runDaemon\s*\(/);
    expect(source).toMatch(/class\s+ProvisionedHome\s+implements\s+LLMProvider/);
    expect(source).toMatch(/dispatches\s*=\s*0/);
    expect(source).toMatch(/dispatchAfterLivePreflight\s*\(\s*providerHome\s*,\s*async/);
    expect(source).toMatch(/\.pipeline[/'"`]+DONE|join\([^)]*pipeline[^)]*['"]DONE['"]/);
    expect(source).toMatch(/\.pipeline[/'"`]+HALT|join\([^)]*pipeline[^)]*['"]HALT['"]/);
    expect(source).toMatch(/\.daemon[/'"`]+parked|join\([^)]*\.daemon[^)]*['"]parked['"]/);
    expect(source).toContain('test/fixtures/daemon-e2e/touched.txt');
    expect(source).toMatch(/Task:/);

    expect(source).not.toMatch(/providerCalls\s*[:),]/);
    expect(source).not.toContain('test: complete fixture task');
    expect(source).not.toMatch(/retry(?:Count|Attempts?)\s*[:=]/i);
  });

  it('combines an accumulated token cap with an independent workflow wall-clock timeout', async () => {
    const [smoke, workflow] = await Promise.all([
      requiredSource(LIVE_SMOKE_PATH),
      requiredSource(WORKFLOW_PATH),
    ]);

    expect(smoke).toMatch(/tokenUsage/);
    expect(smoke).toMatch(/process\.env\.[A-Z0-9_]*TOKEN[A-Z0-9_]*CAP/);
    expect(smoke).toMatch(/console\.(?:log|info)\([^)]*(?:token|cost)/i);
    expect(smoke).toMatch(/(?:cap|limit)[^\n]*(?:observed|total)|(?:observed|total)[^\n]*(?:cap|limit)/i);
    expect(workflow).toMatch(/timeout-minutes:\s*[1-9][0-9]*/);
  });

  it('shares one diagnostics implementation that reports terminal and task-evidence state', async () => {
    const [fixture, smoke] = await Promise.all([
      requiredSource(FIXTURE_PATH),
      requiredSource(LIVE_SMOKE_PATH),
    ]);

    expect(fixture).toMatch(/export\s+async\s+function\s+dumpPipelineDiagnostics/);
    expect(fixture).toContain('task-status.json');
    expect(fixture).toContain('task-evidence.json');
    expect(smoke).toMatch(/import\s*\{[^}]*dumpPipelineDiagnostics[^}]*\}\s*from/);
    expect(smoke).not.toMatch(/function\s+dumpPipelineDiagnostics/);
  });

  it('keeps the live workflow advisory to merges and fail-closed for reusable gating callers', async () => {
    const [workflow, ci, smoke] = await Promise.all([
      requiredSource(WORKFLOW_PATH),
      requiredSource(join(REPO_ROOT, '.github/workflows/ci.yml')),
      requiredSource(LIVE_SMOKE_PATH),
    ]);

    expect(workflow).toMatch(/workflow_dispatch\s*:/);
    expect(workflow).toMatch(/workflow_call\s*:/);
    expect(workflow).toMatch(/require_credentials:[\s\S]*?type:\s*boolean[\s\S]*?default:\s*false/);
    expect(workflow).not.toMatch(/^\s*(?:pull_request|schedule)\s*:/m);
    expect(workflow).toMatch(/fail-fast:\s*false/);
    expect(workflow).toMatch(/provider:\s*\[\s*claude\s*\]/);
    expect(workflow).toMatch(/inputs\.require_credentials/);
    expect(workflow).toMatch(/CLAUDE_CODE_OAUTH_TOKEN/);
    expect(workflow).toMatch(/npm\s+run\s+smoke/);
    expect(workflow).toMatch(/SMOKE_MODE:\s*\$\{\{\s*inputs\.require_credentials\s*&&\s*'gate'\s*\|\|\s*'advisory'\s*\}\}/);

    const ciGate = ci.slice(ci.indexOf('ci-gate:'));
    expect(ciGate).not.toMatch(/live-daemon-e2e|daemon-e2e-live/);

    expect(smoke).toMatch(/describe\.skipIf\s*\(/);
    expect(smoke).toMatch(/CLAUDE_CODE_OAUTH_TOKEN/);
    expect(smoke).toMatch(/delete\s+process\.env\.AI_CONDUCTOR_NO_REAL_EXEC/);
    expect(smoke).toMatch(/expect\(process\.env\.AI_CONDUCTOR_NO_REAL_EXEC\)\.toBeUndefined\(\)/);
  });

  it('collects the direct live-smoke command while retaining the normal Vitest environment', async () => {
    const parentRunRoot = process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
    // A nested Vitest run installs the same run-scoped tmpdir guards as its
    // parent (test/global-setup.ts), so it needs a private tmpdir of its own.
    // Inheriting AI_CONDUCTOR_TEST_TMP_ROOT would make the child adopt — and at
    // teardown delete — the parent's run root mid-suite; inheriting only TMPDIR
    // would make the child treat the parent's run root as the "real" tmpdir and
    // report the parent's concurrent mkdtemp directories as leaks. Hand it a
    // dedicated directory instead. It is created under the parent's run root,
    // so the parent's own teardown reclaims it even if this test dies.
    const childTmpdir = await mkdtemp(join(tmpdir(), 'daemon-e2e-live-nested-'));
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      AI_CONDUCTOR_NO_REAL_EXEC: '1',
      CLAUDE_CODE_OAUTH_TOKEN: '',
      DAEMON_E2E_LIVE_SMOKE: '0',
      TMPDIR: childTmpdir,
      // Pin the child's reporter output to plain text. Under CI the parent's
      // environment turns colour ON, and a coloured summary interleaves ANSI
      // escapes between "Test Files" and "1 passed" — which the assertion below
      // cannot match. Locally (no CI, not a TTY) colour is off, so the
      // assertion passed on a developer machine and failed only in CI.
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    };
    delete childEnv.AI_CONDUCTOR_TEST_TMP_ROOT;

    try {
      const result = await execa(
        'npx',
        [
          'vitest', 'run', '--config', 'vitest.live-smoke.config.ts',
          'test/engine/daemon-e2e-live.smoke.test.ts', '--reporter=dot',
        ],
        {
          cwd: CONDUCTOR_ROOT,
          env: childEnv,
          extendEnv: false,
        },
      );

      expect(result.stdout).toMatch(/Test Files\s+1 passed/);
      expect(existsSync(parentRunRoot ?? '')).toBe(true);
    } finally {
      await rm(childTmpdir, { recursive: true, force: true });
    }
  });
});

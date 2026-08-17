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

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CONDUCTOR_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const REPO_ROOT = join(CONDUCTOR_ROOT, '..', '..');
const LIVE_SMOKE_PATH = join(
  CONDUCTOR_ROOT,
  'test/engine/daemon-e2e-live-claude.smoke.test.ts',
);
const FIXTURE_PATH = join(
  CONDUCTOR_ROOT,
  'test/engine/daemon-e2e-fixture.test.ts',
);
const LIVE_RUN_BODY_PATH = join(
  CONDUCTOR_ROOT,
  'test/fixtures/live-e2e-run-body.ts',
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
    const [smoke, source] = await Promise.all([
      requiredSource(LIVE_SMOKE_PATH),
      requiredSource(LIVE_RUN_BODY_PATH),
    ]);

    expect(smoke).toMatch(/defineLiveE2EProviderSmoke\(provider\)/);
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
    expect(source).toMatch(/expect\(\{[\s\S]*terminal:\s*await\s+hasSuccessfulTerminalState[\s\S]*madeCommit:\s*commitSha\.trim\(\)\s*!==\s*baselineSha\?\.trim\(\)[\s\S]*touchedFixture:[\s\S]*taskTrailer:[\s\S]*\}\)\.toEqual\(\{\s*terminal:\s*true,\s*madeCommit:\s*true,\s*touchedFixture:\s*true,\s*taskTrailer:\s*true\s*\}\)/);
  });

  it('combines an accumulated token cap with an independent workflow wall-clock timeout', async () => {
    const [smoke, runBody, workflow] = await Promise.all([
      requiredSource(LIVE_SMOKE_PATH),
      requiredSource(LIVE_RUN_BODY_PATH),
      requiredSource(WORKFLOW_PATH),
    ]);

    expect(runBody).toMatch(/tokenUsage/);
    expect(runBody).toMatch(/DAEMON_E2E_LIVE_TOKEN_CAP/);
    expect(runBody).toMatch(/reportLiveE2ESpend/);
    expect(runBody).toMatch(/(?:cap|limit)[^\n]*(?:observed|total)|(?:observed|total)[^\n]*(?:cap|limit)/i);
    expect(runBody).toMatch(/expect\(meter\.totalTurns\)\.toBeGreaterThan\(0\)/);
    expect(runBody).toMatch(/expect\(meter\.totalTokens\)\.toBeGreaterThan\(0\)/);
    expect(runBody).toMatch(/assertTokenCap\(observed\.totalTokens,\s*observed\.unmetered,\s*cap\)/);
    expect(runBody).toMatch(/const\s+STEPS_ALLOWED_UNMETERED[^=]*=\s*\[\s*['\"]finish['\"]\s*\]/);
    expect(runBody).toMatch(/meter\.unmeteredSteps\.filter\([\s\S]*!STEPS_ALLOWED_UNMETERED\.includes/);
    expect(workflow).toMatch(/timeout-minutes:\s*[1-9][0-9]*/);
  });

  it('shares one diagnostics implementation that reports terminal and task-evidence state', async () => {
    const [fixture, runBody] = await Promise.all([
      requiredSource(FIXTURE_PATH),
      requiredSource(LIVE_RUN_BODY_PATH),
    ]);

    expect(fixture).toMatch(/export\s+async\s+function\s+dumpPipelineDiagnostics/);
    expect(fixture).toContain('task-status.json');
    expect(fixture).toContain('task-evidence.json');
    expect(runBody).toMatch(/import\s*\{[^}]*dumpPipelineDiagnostics[^}]*\}\s*from/);
    expect(runBody).not.toMatch(/function\s+dumpPipelineDiagnostics/);
  });

  it('keeps the live workflow advisory to merges and makes each credential-present leg gate-enforced', async () => {
    const [workflow, ci, smoke, runBody] = await Promise.all([
      requiredSource(WORKFLOW_PATH),
      requiredSource(join(REPO_ROOT, '.github/workflows/ci.yml')),
      requiredSource(LIVE_SMOKE_PATH),
      requiredSource(LIVE_RUN_BODY_PATH),
    ]);

    expect(workflow).toMatch(/workflow_dispatch\s*:/);
    expect(workflow).toMatch(/workflow_call\s*:/);
    expect(workflow).not.toMatch(/^\s*(?:pull_request|schedule)\s*:/m);
    expect(workflow).toMatch(/fail-fast:\s*false/);
    expect(workflow).toMatch(/include:[\s\S]*provider:\s*claude[\s\S]*provider:\s*codex/);
    expect(workflow).toMatch(/CLAUDE_CODE_OAUTH_TOKEN/);
    expect(workflow).toMatch(/export\s+"\$\{\{\s*matrix\.credential_env\s*\}\}=\$LIVE_PROVIDER_CREDENTIAL"/);
    expect(workflow).toMatch(/SMOKE_MODE=gate\s+npm\s+run\s+smoke\s+--\s+"\$\{\{\s*matrix\.smoke_file\s*\}\}"/);
    expect(workflow).toMatch(/unset\s+LIVE_PROVIDER_CREDENTIAL/);
    expect(workflow).not.toMatch(/exit\s+0/);

    const ciGate = ci.slice(ci.indexOf('ci-gate:'));
    expect(ciGate).not.toMatch(/live-daemon-e2e|daemon-e2e-live/);

    expect(runBody).toMatch(/describe\.skipIf\s*\(/);
    expect(smoke).toMatch(/credentialed:claude/);
    expect(runBody).toMatch(/delete\s+process\.env\.AI_CONDUCTOR_NO_REAL_EXEC/);
    expect(runBody).toMatch(/expect\(process\.env\.AI_CONDUCTOR_NO_REAL_EXEC\)\.toBeUndefined\(\)/);
  });

  it('routes the live workflow through the full smoke entry point without running third-party smoke cases in acceptance', async () => {
    const [workflow, packageJson, smokeConfig] = await Promise.all([
      requiredSource(WORKFLOW_PATH),
      requiredSource(join(CONDUCTOR_ROOT, 'package.json')),
      requiredSource(join(CONDUCTOR_ROOT, 'vitest.smoke.config.ts')),
    ]);

    expect(workflow).toMatch(/SMOKE_MODE=gate\s+npm\s+run\s+smoke\s+--\s+"\$\{\{\s*matrix\.smoke_file\s*\}\}"/);
    expect(workflow).not.toMatch(/(?:npx\s+)?vitest\s+run/);
    expect(JSON.parse(packageJson).scripts.smoke)
      .toBe('node --import tsx scripts/smoke.ts vitest.smoke.config.ts');
    expect(smokeConfig).toMatch(/environment:\s*['"]node['"]/);
    expect(smokeConfig).toMatch(/setupFiles:\s*\[\s*['"]\.\/test\/setup\.ts['"]\s*\]/);
    expect(smokeConfig).toMatch(/globalSetup:\s*\[\s*['"]\.\/test\/global-setup\.ts['"]\s*\]/);
  });
});

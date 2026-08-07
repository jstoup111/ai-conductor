/**
 * RED acceptance specs for
 * `.docs/stories/live-daemon-e2e-build-step-never-runs-a-real-agent.md`.
 *
 * The real provider subprocess is replaced at ClaudeProvider's production
 * subprocess seam. The opt-in smoke remains the only test allowed to call a
 * real agent.
 *
 * Existing coverage intentionally retained elsewhere:
 * - daemon-e2e-live-agent-tier.acceptance.test.ts owns the outcome-only
 *   terminal/commit/fixture/trailer assertions, workflow trigger contract,
 *   shared diagnostics, and credentialed skip predicate.
 * - lower-layer TDD owns individual helper boundary cases and token-meter
 *   arithmetic; this file owns the cross-boundary story contracts.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import type { InvokeResult } from '../../src/execution/llm-provider.js';

const CONDUCTOR_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const LIVE_SMOKE_PATH = join(
  CONDUCTOR_ROOT,
  'test/engine/daemon-e2e-live.smoke.test.ts',
);
const LIVE_HOME_PATH = join(
  CONDUCTOR_ROOT,
  'test/fixtures/live-provider-home.ts',
);
const PREFLIGHT_PATH = join(
  CONDUCTOR_ROOT,
  'test/fixtures/step-command-preflight.ts',
);
const CONDUCTOR_PATH = join(CONDUCTOR_ROOT, 'src/engine/conductor.ts');

async function requiredSource(path: string): Promise<string> {
  return readFile(path, 'utf8').catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`required live-tier behavior is not implemented: ${path}: ${detail}`);
  });
}

type UnresolvedCommandResult = InvokeResult & {
  commandUnresolved?: boolean;
  commandUnresolvedName?: string;
};

function providerForEnvelope(envelope: Record<string, unknown>): ClaudeProvider {
  const subprocessFactory = () => Promise.resolve({
    stdout: JSON.stringify(envelope),
    stderr: '',
    exitCode: 0,
    failed: false,
  }) as never;
  return new ClaudeProvider(undefined, subprocessFactory);
}

async function invokeEnvelope(
  prompt: string,
  envelope: Record<string, unknown>,
): Promise<UnresolvedCommandResult> {
  return providerForEnvelope(envelope).invoke({
    prompt,
    sessionId: 'acceptance-unresolved-command',
    resume: false,
    dangerouslySkipPermissions: true,
  });
}

describe('live daemon E2E command resolution (#1311)', () => {
  it('provisions copied checkout skills inside the selected live case and routes that home into dispatch', async () => {
    const [home, smoke] = await Promise.all([
      requiredSource(LIVE_HOME_PATH),
      requiredSource(LIVE_SMOKE_PATH),
    ]);

    expect(home).toMatch(/provisionProviderHome/);
    expect(home).toMatch(/export\s+(?:async\s+)?function\s+provisionLiveProviderHome/);
    expect(home).toMatch(/CLAUDE_CODE_OAUTH_TOKEN/);
    expect(home).not.toMatch(/symlink\s*\([^)]*worktree|bin\/install|\.claude\.json/);

    const selectedCase = smoke.indexOf("describe.skipIf(!shouldRun)");
    const provisioning = smoke.indexOf('provisionLiveProviderHome');
    expect(selectedCase).toBeGreaterThanOrEqual(0);
    expect(provisioning).toBeGreaterThan(selectedCase);
    expect(smoke).toMatch(/selfHost\s*:/);
    expect(smoke).toMatch(/finally\s*\{[\s\S]*teardown\s*\(/);
  });

  it('preflights every registry-rendered command from the provisioned home before provider dispatch', async () => {
    const [preflight, smoke] = await Promise.all([
      requiredSource(PREFLIGHT_PATH),
      requiredSource(LIVE_SMOKE_PATH),
    ]);

    expect(preflight).toMatch(/STEP_SKILL_INVOCATIONS/);
    expect(preflight).toMatch(/renderSkillInvocation/);
    expect(preflight).toMatch(
      /descriptor\.kind\s*(?:===?\s*['"]skill['"]|!==?\s*['"]skill['"]\s*\)\s*return\s*\[\])/,
    );
    expect(preflight).toMatch(/SKILL\.md/);
    expect(preflight).toMatch(/missing|unresolved/i);
    expect(preflight).toMatch(/custom|project configuration|parallel/i);
    expect(preflight).not.toMatch(/['"]pipeline['"]/);
    expect(preflight).not.toMatch(/\.invoke\s*\(|exec(?:File)?\s*\(|fetch\s*\(/);

    const preflightCall = smoke.search(/preflight|assertStepCommandsResolve/);
    const providerConstruction = smoke.indexOf('new ClaudeProvider');
    expect(preflightCall).toBeGreaterThanOrEqual(0);
    expect(providerConstruction).toBeGreaterThan(preflightCall);
    expect(smoke).toMatch(/dispatch(?:es|Count)[\s\S]*0|0[\s\S]*dispatch(?:es|Count)/i);
  });

  it('classifies the observed zero-turn unknown-command envelope as a named failure at the provider boundary', async () => {
    const result = await invokeEnvelope('/pipeline', {
      subtype: 'success',
      is_error: false,
      num_turns: 0,
      result: 'Unknown command: /pipeline',
      usage: { input_tokens: 0, output_tokens: 0 },
    });

    expect(result).toMatchObject({
      success: false,
      exitCode: 0,
      commandUnresolved: true,
      commandUnresolvedName: 'pipeline',
    });
    expect(result.output).toContain('/pipeline');
  });

  it('does not misclassify ordinary prose, a bare zero-turn result, or a different command', async () => {
    const [prose, bareZeroTurn, differentCommand] = await Promise.all([
      invokeEnvelope('/pipeline', {
        subtype: 'success',
        is_error: false,
        num_turns: 3,
        result: 'I fixed an unknown command reported by the test.',
        usage: { input_tokens: 12, output_tokens: 5 },
      }),
      invokeEnvelope('/pipeline', {
        subtype: 'success',
        is_error: false,
        num_turns: 0,
        result: 'No work was required.',
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
      invokeEnvelope('/pipeline', {
        subtype: 'success',
        is_error: false,
        num_turns: 0,
        result: 'Unknown command: /stories',
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    ]);

    for (const result of [prose, bareZeroTurn, differentCommand]) {
      expect(result.success).toBe(true);
      expect(result.commandUnresolved).toBeUndefined();
      expect(result.commandUnresolvedName).toBeUndefined();
    }
  });

  it('routes unresolved commands as zero-retry mechanical failures while preserving outcome-based regression diagnostics', async () => {
    const [conductor, smoke] = await Promise.all([
      requiredSource(CONDUCTOR_PATH),
      requiredSource(LIVE_SMOKE_PATH),
    ]);

    expect(conductor).toMatch(/commandUnresolved/);
    expect(conductor).toMatch(/commandUnresolved[\s\S]{0,1200}mechanical|mechanical[\s\S]{0,1200}commandUnresolved/);
    expect(smoke).toMatch(/dumpPipelineDiagnostics/);
    expect(smoke).toMatch(/terminal[\s\S]*madeCommit[\s\S]*touchedFixture[\s\S]*taskTrailer/);
    expect(smoke).toMatch(/commandUnresolved|unresolved command/i);

    const outcomeAssertion = smoke.match(/expect\s*\(\s*\{[\s\S]*?\}\s*\)\.toEqual\s*\(\s*\{[\s\S]*?\}\s*\)/)?.[0] ?? '';
    expect(outcomeAssertion).not.toMatch(/numTurns|turnCount|dispatchCount|agent wording/i);
  });
});

/** Acceptance coverage for the live-agent daemon E2E tier. */

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import type { InvokeOptions, LLMProvider } from '../../src/execution/llm-provider.js';
import { dumpPipelineDiagnostics } from '../engine/daemon-e2e-fixture.test.js';
import { LIVE_E2E_PROVIDERS } from '../fixtures/live-e2e-providers.js';
import {
  enforceLiveE2ETokenCap,
  reportLiveE2ESpend,
  TokenMeter,
  withLiveE2EFailureDiagnostics,
} from '../fixtures/live-e2e-run-body.js';

vi.mock('../engine/daemon-e2e-fixture.test.js', () => ({
  dumpPipelineDiagnostics: vi.fn(),
}));

const CONDUCTOR_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const REPO_ROOT = join(CONDUCTOR_ROOT, '..', '..');
const WORKFLOW_PATH = join(REPO_ROOT, '.github/workflows/live-daemon-e2e.yml');

async function requiredSource(path: string): Promise<string> {
  return readFile(path, 'utf8').catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`required live-tier artifact is not implemented: ${path}: ${detail}`);
  });
}

describe('live-agent daemon E2E tier (#1124)', () => {
  it('wires the real Claude provider through the descriptor and restores its isolated auth', async () => {
    const claude = LIVE_E2E_PROVIDERS.find(({ id }) => id === 'claude');
    expect(claude).toBeDefined();
    const priorToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;

    try {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'live-claude-token';
      const provider = claude!.createProvider();
      const authenticationSource = await claude!.resolveAuthenticationSource(provider);
      const selfHostAuth = await provider.prepareSelfHostAuth?.({
        provider: 'claude', homeDir: '/tmp/live-e2e-claude-home',
      });

      expect({ authenticationSource, selfHostAuth }).toEqual({
        authenticationSource: 'oauth-token',
        selfHostAuth: { env: { CLAUDE_CODE_OAUTH_TOKEN: 'live-claude-token' }, args: [] },
      });
    } finally {
      if (priorToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      else process.env.CLAUDE_CODE_OAUTH_TOKEN = priorToken;
    }
  });

  it('combines an accumulated token cap with an independent workflow wall-clock timeout', async () => {
    const provider: LLMProvider = {
      invoke: vi.fn()
        .mockResolvedValueOnce({ success: true, output: 'first', exitCode: 0, tokenUsage: { input: 11, output: 7, numTurns: 1 } })
        .mockResolvedValueOnce({ success: true, output: 'second', exitCode: 0, tokenUsage: { input: 13, output: 11, numTurns: 2 } }),
      invokeInteractive: vi.fn(),
    };
    const meter = new TokenMeter(provider);
    const report = vi.fn();

    await meter.invoke({ prompt: 'first', sessionId: 'one', resume: false } satisfies InvokeOptions);
    await meter.invoke({ prompt: 'second', sessionId: 'two', resume: false } satisfies InvokeOptions);
    reportLiveE2ESpend({ totalTokens: meter.totalTokens, dispatches: 2 }, 41, report);
    await expect(enforceLiveE2ETokenCap(async () => 'completed', () => meter, 41))
      .rejects.toThrow('Token cap 41 exceeded: observed 42; unmetered results: 0');

    expect({ totalTokens: meter.totalTokens, totalTurns: meter.totalTurns, report: report.mock.calls }).toEqual({
      totalTokens: 42,
      totalTurns: 3,
      report: [['daemon E2E live smoke observed total: 42; dispatch count: 2; cap: 41']],
    });
    expect(await requiredSource(WORKFLOW_PATH)).toMatch(/timeout-minutes:\s*[1-9][0-9]*/);
  });

  it('shares one diagnostics implementation that reports terminal and task-evidence state', async () => {
    const worktreeDir = await mkdtemp(`${tmpdir()}/live-e2e-acceptance-diagnostics-`);
    const stderr: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });

    try {
      await mkdir(join(worktreeDir, '.daemon'), { recursive: true });
      vi.mocked(dumpPipelineDiagnostics).mockImplementation(async () => {
        console.error('terminal state: HALT');
        console.error('task-evidence.json: present');
        return '';
      });
      await expect(withLiveE2EFailureDiagnostics(
        worktreeDir,
        [],
        async () => { throw new Error('shared diagnostics failure'); },
      )).rejects.toThrow('shared diagnostics failure');

      expect({ calls: vi.mocked(dumpPipelineDiagnostics).mock.calls, diagnostics: stderr.join('\n') }).toEqual({
        calls: [[worktreeDir]],
        diagnostics: expect.stringContaining('terminal state: HALT'),
      });
      expect(stderr.join('\n')).toContain('task-evidence.json: present');
    } finally {
      errorSpy.mockRestore();
      vi.mocked(dumpPipelineDiagnostics).mockReset();
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });

  it('keeps the live workflow advisory to merges and makes each credential-present leg gate-enforced', async () => {
    const [workflow, ci] = await Promise.all([
      requiredSource(WORKFLOW_PATH),
      requiredSource(join(REPO_ROOT, '.github/workflows/ci.yml')),
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
    expect(ci.slice(ci.indexOf('ci-gate:'))).not.toMatch(/live-daemon-e2e|daemon-e2e-live/);
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

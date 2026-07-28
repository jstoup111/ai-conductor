import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { execa } from 'execa';
import { CODEX_AUTH_FAILURE_RE } from '../../src/execution/codex-provider.js';

/**
 * Opt-in real Codex CLI compatibility checks. These commands never invoke
 * `exec` with a prompt: doctor is read-only and --help exits before a run.
 *
 * Run manually when a local Codex binary is available:
 *   CODEX_CLI_SMOKE_TEST=1 npx vitest run test/execution/codex-provider.smoke.test.ts
 */
function codexBinaryAvailable(): boolean {
  try {
    execFileSync('which', ['codex'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const shouldRun = process.env.CODEX_CLI_SMOKE_TEST === '1' && codexBinaryAvailable();
const policyArgs = [
  '--config', 'sandbox_mode="workspace-write"',
  '--config', 'approval_policy="on-request"',
  '--config', 'approvals_reviewer="auto_review"',
  '--config', 'shell_environment_policy.ignore_default_excludes=false',
];

describe.skipIf(!shouldRun)('codex CLI readiness compatibility (real binary)', () => {
  it('reports the supported doctor JSON summary envelope without credentials', async () => {
    const home = await mkdtemp(join(tmpdir(), 'codex-smoke-empty-home-'));
    try {
      const result = await execa('codex', ['doctor', '--json', '--summary'], {
        reject: false,
        timeout: 15_000,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          PATH: process.env.PATH ?? '',
          HOME: home,
          XDG_CONFIG_HOME: join(home, 'config'),
          XDG_DATA_HOME: join(home, 'data'),
        },
      });

      const doctor = JSON.parse(result.stdout) as {
        schemaVersion?: unknown;
        overallStatus?: unknown;
        checks?: { 'auth.credentials'?: unknown };
      };
      expect(doctor).toMatchObject({
        schemaVersion: expect.any(Number),
        overallStatus: expect.any(String),
        checks: { 'auth.credentials': expect.any(Object) },
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('classifies an isolated invalid API key when this CLI exposes rejection evidence', async (ctx) => {
    const home = await mkdtemp(join(tmpdir(), 'codex-smoke-empty-home-'));
    try {
      const result = await execa('codex', ['doctor', '--json', '--summary'], {
        reject: false,
        timeout: 15_000,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          PATH: process.env.PATH ?? '',
          HOME: home,
          XDG_CONFIG_HOME: join(home, 'config'),
          XDG_DATA_HOME: join(home, 'data'),
          CODEX_API_KEY: 'codex-smoke-deliberately-invalid-key',
        },
      });
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n');

      if (result.exitCode === 0) {
        // This Codex doctor build does not validate API keys; no
        // non-mutating rejection evidence is available.
        ctx.skip();
        return;
      }
      expect(CODEX_AUTH_FAILURE_RE.test(output)).toBe(true);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('accepts the unattended policy argv for initial and resumed exec help', async () => {
    const initial = await execa('codex', ['exec', ...policyArgs, '--json', '--help'], {
      reject: false,
      timeout: 15_000,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const resumed = await execa('codex', ['exec', 'resume', ...policyArgs, '--json', '--help'], {
      reject: false,
      timeout: 15_000,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect([initial.exitCode, resumed.exitCode]).toEqual([0, 0]);
  });

  it('exposes no flag that pre-registers a caller-supplied session id', async () => {
    const [initial, resumed] = await Promise.all([
      execa('codex', ['exec', '--help'], {
        reject: false,
        timeout: 15_000,
        stdout: 'pipe',
        stderr: 'pipe',
      }),
      execa('codex', ['exec', 'resume', '--help'], {
        reject: false,
        timeout: 15_000,
        stdout: 'pipe',
        stderr: 'pipe',
      }),
    ]);

    expect([initial.exitCode, resumed.exitCode]).toEqual([0, 0]);
    expect([initial.stdout, resumed.stdout].join('\n')).not.toMatch(/--(?:session|thread)[-_]?id\b/i);
  });
});

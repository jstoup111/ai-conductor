import { describe, it, expect } from 'vitest';
import {
  verifyTokenLiveness,
  type LivenessSpawner,
  type LivenessSpawnResult,
} from '../../../src/engine/self-host/token-liveness.js';

// ADR: adr-2026-07-22-token-liveness-probe-via-cli-invocation
// Verdict mapping (fail-safe, never claims valid without positive signal):
//   valid       — envelope parses and is_error is false
//   invalid     — api_error_status 401/403
//   unverifiable — anything else: spawn failure, timeout, unparseable, unexpected status

const TOKEN = 'sk-ant-oat01-super-secret-do-not-leak';

function makeSpawner(result: LivenessSpawnResult): {
  spawner: LivenessSpawner;
  calls: Array<{ argv: string[]; env: NodeJS.ProcessEnv }>;
} {
  const calls: Array<{ argv: string[]; env: NodeJS.ProcessEnv }> = [];
  const spawner: LivenessSpawner = async (argv, env) => {
    calls.push({ argv, env });
    return result;
  };
  return { spawner, calls };
}

describe('verifyTokenLiveness', () => {
  it('maps a success envelope (is_error false, exit 0) to valid', async () => {
    const { spawner } = makeSpawner({
      exitCode: 0,
      stdout: JSON.stringify({ is_error: false, total_cost_usd: 0.0001 }),
      timedOut: false,
    });

    const result = await verifyTokenLiveness({ token: TOKEN, spawner });

    expect(result.verdict).toBe('valid');
  });

  it('maps api_error_status 401 to invalid', async () => {
    const { spawner } = makeSpawner({
      exitCode: 1,
      stdout: JSON.stringify({
        is_error: true,
        api_error_status: 401,
        terminal_reason: 'api_error',
      }),
      timedOut: false,
    });

    const result = await verifyTokenLiveness({ token: TOKEN, spawner });

    expect(result.verdict).toBe('invalid');
  });

  it('maps api_error_status 403 to invalid', async () => {
    const { spawner } = makeSpawner({
      exitCode: 1,
      stdout: JSON.stringify({
        is_error: true,
        api_error_status: 403,
        terminal_reason: 'api_error',
      }),
      timedOut: false,
    });

    const result = await verifyTokenLiveness({ token: TOKEN, spawner });

    expect(result.verdict).toBe('invalid');
  });

  it('maps a timeout to unverifiable with sanitized detail (no token material)', async () => {
    const spawner: LivenessSpawner = async () => ({
      exitCode: null,
      stdout: '',
      timedOut: true,
    });

    const result = await verifyTokenLiveness({ token: TOKEN, spawner });

    expect(result.verdict).toBe('unverifiable');
    expect(result.detail).toBeDefined();
    expect(result.detail).not.toContain(TOKEN);
  });

  it('maps a spawn error to unverifiable', async () => {
    const spawner: LivenessSpawner = async () => {
      throw new Error('ENOENT: no such file or directory, spawn claude');
    };

    const result = await verifyTokenLiveness({ token: TOKEN, spawner });

    expect(result.verdict).toBe('unverifiable');
    expect(result.detail).not.toContain(TOKEN);
  });

  it('maps unparseable output to unverifiable', async () => {
    const { spawner } = makeSpawner({
      exitCode: 1,
      stdout: 'not json at all {{{',
      timedOut: false,
    });

    const result = await verifyTokenLiveness({ token: TOKEN, spawner });

    expect(result.verdict).toBe('unverifiable');
  });

  it('maps an unexpected status (non-401/403 error, non-clean success) to unverifiable', async () => {
    const { spawner } = makeSpawner({
      exitCode: 1,
      stdout: JSON.stringify({
        is_error: true,
        api_error_status: 500,
        terminal_reason: 'api_error',
      }),
      timedOut: false,
    });

    const result = await verifyTokenLiveness({ token: TOKEN, spawner });

    expect(result.verdict).toBe('unverifiable');
  });

  it('maps a parsed envelope with no explicit is_error field to unverifiable (no default-valid)', async () => {
    const { spawner } = makeSpawner({
      exitCode: 0,
      stdout: JSON.stringify({ total_cost_usd: 0 }),
      timedOut: false,
    });

    const result = await verifyTokenLiveness({ token: TOKEN, spawner });

    expect(result.verdict).not.toBe('valid');
    expect(result.verdict).toBe('unverifiable');
  });

  it('passes the token to the spawned process via env var only, never in argv', async () => {
    const { spawner, calls } = makeSpawner({
      exitCode: 0,
      stdout: JSON.stringify({ is_error: false }),
      timedOut: false,
    });

    await verifyTokenLiveness({ token: TOKEN, spawner });

    expect(calls).toHaveLength(1);
    const { argv, env } = calls[0];
    expect(argv.join(' ')).not.toContain(TOKEN);
    expect(Object.values(env).some((v) => v === TOKEN)).toBe(true);
  });

  it('Task 11: no unverifiable-path detail string contains the token substring', async () => {
    const TOKEN_FIXTURE = 'zqx9RmTt7pLk3vEwYbNcGhJdSfAoXu2M';

    const spawnerCases: LivenessSpawner[] = [
      // timeout
      async () => ({ exitCode: null, stdout: '', timedOut: true }),
      // spawn error whose message happens to include env-flavored text
      async () => {
        throw new Error(`spawn failed near token ${TOKEN_FIXTURE}`);
      },
      // unparseable envelope that echoes the token in raw stdout
      async () => ({ exitCode: 1, stdout: `not json ${TOKEN_FIXTURE} {{{`, timedOut: false }),
      // unexpected status envelope embedding the token in an extraneous field
      async () => ({
        exitCode: 1,
        stdout: JSON.stringify({ is_error: true, api_error_status: 500, extra: TOKEN_FIXTURE }),
        timedOut: false,
      }),
    ];

    for (const spawner of spawnerCases) {
      const result = await verifyTokenLiveness({ token: TOKEN_FIXTURE, spawner });
      expect(result.verdict).toBe('unverifiable');
      expect(JSON.stringify(result)).not.toContain(TOKEN_FIXTURE);
    }
  });

  it('Task 11: spawner argv never contains any substring of the token', async () => {
    const TOKEN_FIXTURE = 'zqx9RmTt7pLk3vEwYbNcGhJdSfAoXu2M';
    const { spawner, calls } = makeSpawner({
      exitCode: 0,
      stdout: JSON.stringify({ is_error: false }),
      timedOut: false,
    });

    await verifyTokenLiveness({ token: TOKEN_FIXTURE, spawner });

    expect(calls).toHaveLength(1);
    const { argv } = calls[0];
    for (const arg of argv) {
      expect(arg).not.toContain(TOKEN_FIXTURE);
    }
  });

  it('never returns valid without an explicit positive signal — default/unknown cases stay unverifiable', async () => {
    const cases: LivenessSpawnResult[] = [
      { exitCode: 0, stdout: '', timedOut: false },
      { exitCode: 1, stdout: '{}', timedOut: false },
      { exitCode: null, stdout: '', timedOut: true },
    ];

    for (const spawnResult of cases) {
      const { spawner } = makeSpawner(spawnResult);
      const result = await verifyTokenLiveness({ token: TOKEN, spawner });
      expect(result.verdict).not.toBe('valid');
    }
  });
});

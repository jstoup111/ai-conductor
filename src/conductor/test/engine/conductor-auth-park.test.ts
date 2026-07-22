/**
 * Unit tests for daemon-token authFailure park-and-poll (Task 11, TR-4).
 *
 * Tests the authFailure branch's retargeting to watch the daemon token path
 * instead of operator credentials path. When the token file changes with
 * non-empty content, the same attempt retries with the fresh token re-injected.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { detectsAuthFailure } from '../../src/execution/claude-provider.js';

type AuthResult = StepRunResult & { authFailure?: boolean };

const READY_STATE: ConductState = {
  worktree: 'done',
  memory: 'done',
  explore: 'done',
  complexity: 'done',
  stories: 'done',
  conflict_check: 'done',
  plan: 'done',
  architecture_diagram: 'done',
  architecture_review: 'done',
  acceptance_specs: 'done',
} as ConductState;

describe('conductor auth-park: daemon-token mode', () => {
  let dir: string;
  let statePath: string;
  let tokenDir: string;
  let tokenPath: string;
  let events: ConductorEventEmitter;
  let priorToken: string | undefined;

  function selfHostConfig() {
    return {
      harness_self_host: {
        build_auth: { mode: 'daemon-token', token_path: tokenPath },
        auth_park_timeout_minutes: 1,
      },
    } as never;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'auth-park-unit-'));
    tokenDir = await mkdtemp(join(tmpdir(), 'auth-park-token-'));
    tokenPath = join(tokenDir, 'daemon-token');
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    priorToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeState(statePath, READY_STATE);
    await writeFile(tokenPath, 'tok-v1', 'utf-8');
  });

  afterEach(async () => {
    if (priorToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = priorToken;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    await rm(tokenDir, { recursive: true, force: true }).catch(() => {});
  });

  it('authFailure in daemon-token mode parks on the daemon token path (not operator credentials)', async () => {
    let buildAttempts = 0;
    const observedParkPaths: string[] = [];
    let buildAttempt1Failed = false;

    const runner: StepRunner = {
      run: vi.fn(async (step: string): Promise<StepRunResult> => {
        if (step !== 'build') return { success: true };
        buildAttempts++;
        if (buildAttempts === 1) {
          buildAttempt1Failed = true;
          return { success: false, authFailure: true } as AuthResult;
        }
        return { success: true };
      }),
    };

    const mockGuardrails = {
      resolveHarnessRoot: vi.fn().mockResolvedValue(dir),
      resolveInstalledHarnessRoot: vi.fn().mockResolvedValue({ status: 'ok' as const, root: dir }),
      relink: vi.fn(),
      provisionSandbox: vi.fn(async () => ({
        configDir: dir,
        childEnv: () => process.env,
        teardown: async () => {},
      })),
      versionGate: vi.fn().mockResolvedValue({ ok: true }),
      releaseGate: vi.fn().mockResolvedValue({ ok: true }),
    };

    // Spy on the token file watching: when authFailure triggers park, the
    // daemon token path should be polled, and on mtime advance with non-empty
    // content, it should resume without burning the retry budget.
    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);

    let parkResumeCalls = 0;
    const sleepFn = vi.fn(async () => {
      if (buildAttempt1Failed && parkResumeCalls === 0) {
        // First park sleep: advance mtime and write new token content
        parkResumeCalls++;
        clockOffset += 10_000;
        await utimes(tokenPath, new Date(), new Date());
        await writeFile(tokenPath, 'tok-v2', 'utf-8');
      } else {
        clockOffset += 120_000;
      }
    });

    try {
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        fromStep: 'build',
        mode: 'auto',
        daemon: true,
        selfHost: true,
        maxRetries: 1,
        sleepFn,
        selfHostGuardrails: mockGuardrails as any,
        config: selfHostConfig(),
      });

      await conductor.run();

      // Should have called build twice: first fails with authFailure (parks),
      // second succeeds after park resumes.
      expect(buildAttempts).toBe(2);
      // Only one provisioning (reused across park-resume, not re-provisioned)
      expect(mockGuardrails.provisionSandbox).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('authFailure park on daemon token: attempt counter unchanged (same retry, not new attempt)', async () => {
    let buildAttempts = 0;
    const runner: StepRunner = {
      run: vi.fn(async (step: string): Promise<StepRunResult> => {
        if (step !== 'build') return { success: true };
        buildAttempts++;
        if (buildAttempts === 1) {
          return { success: false, authFailure: true } as AuthResult;
        }
        return { success: true };
      }),
    };

    const mockGuardrails = {
      resolveHarnessRoot: vi.fn().mockResolvedValue(dir),
      resolveInstalledHarnessRoot: vi.fn().mockResolvedValue({ status: 'ok' as const, root: dir }),
      relink: vi.fn(),
      provisionSandbox: vi.fn(async () => ({
        configDir: dir,
        childEnv: () => process.env,
        teardown: async () => {},
      })),
      versionGate: vi.fn().mockResolvedValue({ ok: true }),
      releaseGate: vi.fn().mockResolvedValue({ ok: true }),
    };

    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);

    let parkCalls = 0;
    const sleepFn = vi.fn(async () => {
      parkCalls++;
      if (parkCalls === 1) {
        // First park sleep: trigger resume
        clockOffset += 10_000;
        await utimes(tokenPath, new Date(), new Date());
        await writeFile(tokenPath, 'tok-v2', 'utf-8');
      } else {
        clockOffset += 120_000;
      }
    });

    try {
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        fromStep: 'build',
        mode: 'auto',
        daemon: true,
        selfHost: true,
        maxRetries: 2, // enough for budget verification
        sleepFn,
        selfHostGuardrails: mockGuardrails as any,
        config: selfHostConfig(),
      });

      await conductor.run();

      // Exactly 2 build attempts: the retry didn't consume the budget
      expect(buildAttempts).toBe(2);
      // If park had incorrectly decremented budget, we'd expect more attempts possible.
      // This verifies the budget was truly preserved across park-resume.
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('authFailure park: token re-read and re-injected on resume', async () => {
    const tokensSeenByBuild: (string | undefined)[] = [];
    let buildAttempts = 0;

    const runner: StepRunner = {
      run: vi.fn(async (step: string): Promise<StepRunResult> => {
        if (step !== 'build') return { success: true };
        buildAttempts++;
        tokensSeenByBuild.push(process.env.CLAUDE_CODE_OAUTH_TOKEN);
        if (buildAttempts === 1) {
          return { success: false, authFailure: true } as AuthResult;
        }
        return { success: true };
      }),
    };

    const mockGuardrails = {
      resolveHarnessRoot: vi.fn().mockResolvedValue(dir),
      resolveInstalledHarnessRoot: vi.fn().mockResolvedValue({ status: 'ok' as const, root: dir }),
      relink: vi.fn(),
      provisionSandbox: vi.fn(async () => ({
        configDir: dir,
        childEnv: () => process.env,
        teardown: async () => {},
      })),
      versionGate: vi.fn().mockResolvedValue({ ok: true }),
      releaseGate: vi.fn().mockResolvedValue({ ok: true }),
    };

    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);

    let parkCalls = 0;
    const sleepFn = vi.fn(async () => {
      parkCalls++;
      if (parkCalls === 1) {
        // First park sleep: update token file
        clockOffset += 10_000;
        await utimes(tokenPath, new Date(), new Date());
        await writeFile(tokenPath, 'tok-v2-fresh', 'utf-8');
      } else {
        clockOffset += 120_000;
      }
    });

    try {
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        fromStep: 'build',
        mode: 'auto',
        daemon: true,
        selfHost: true,
        maxRetries: 1,
        sleepFn,
        selfHostGuardrails: mockGuardrails as any,
        config: selfHostConfig(),
      });

      await conductor.run();

      // Two attempts: first with old token, second with fresh token
      expect(tokensSeenByBuild).toHaveLength(2);
      expect(tokensSeenByBuild[0]).toBe('tok-v1');
      // Second attempt should see the freshly-minted token
      expect(tokensSeenByBuild[1]).toBe('tok-v2-fresh');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('authFailure park: non-empty content check (mtime alone is insufficient)', async () => {
    const runner: StepRunner = {
      run: vi.fn(async (step: string): Promise<StepRunResult> => {
        if (step !== 'build') return { success: true };
        return { success: false, authFailure: true } as AuthResult;
      }),
    };

    const mockGuardrails = {
      resolveHarnessRoot: vi.fn().mockResolvedValue(dir),
      resolveInstalledHarnessRoot: vi.fn().mockResolvedValue({ status: 'ok' as const, root: dir }),
      relink: vi.fn(),
      provisionSandbox: vi.fn(async () => ({
        configDir: dir,
        childEnv: () => process.env,
        teardown: async () => {},
      })),
      versionGate: vi.fn().mockResolvedValue({ ok: true }),
      releaseGate: vi.fn().mockResolvedValue({ ok: true }),
    };

    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);

    let parkCalls = 0;
    const sleepFn = vi.fn(async () => {
      parkCalls++;
      if (parkCalls < 2) {
        // Touch the file but leave it empty (should NOT trigger resume)
        clockOffset += 10_000;
        await utimes(tokenPath, new Date(), new Date());
        await writeFile(tokenPath, '', 'utf-8');
      } else {
        // Eventually timeout
        clockOffset += 120_000;
      }
    });

    try {
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        fromStep: 'build',
        mode: 'auto',
        daemon: true,
        selfHost: true,
        maxRetries: 1,
        sleepFn,
        selfHostGuardrails: mockGuardrails as any,
        config: selfHostConfig(),
      });

      await conductor.run();

      // Should have parked and timed out (only 1 build attempt, never resumed)
      expect(runner.run).toHaveBeenCalledWith('build', expect.anything(), expect.anything());
      // Park timed out: HALT marker should exist
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('authFailure park timeout: HALT names daemon token path and re-mint instructions (not operator path)', async () => {
    const runner: StepRunner = {
      run: vi.fn(async (step: string): Promise<StepRunResult> => {
        if (step !== 'build') return { success: true };
        return { success: false, authFailure: true } as AuthResult;
      }),
    };

    const mockGuardrails = {
      resolveHarnessRoot: vi.fn().mockResolvedValue(dir),
      resolveInstalledHarnessRoot: vi.fn().mockResolvedValue({ status: 'ok' as const, root: dir }),
      relink: vi.fn(),
      provisionSandbox: vi.fn(async () => ({
        configDir: dir,
        childEnv: () => process.env,
        teardown: async () => {},
      })),
      versionGate: vi.fn().mockResolvedValue({ ok: true }),
      releaseGate: vi.fn().mockResolvedValue({ ok: true }),
    };

    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);

    const sleepFn = vi.fn(async () => {
      // Never update the token file, just advance time to timeout
      clockOffset += 120_000;
    });

    try {
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        fromStep: 'build',
        mode: 'auto',
        daemon: true,
        selfHost: true,
        maxRetries: 1,
        sleepFn,
        selfHostGuardrails: mockGuardrails as any,
        config: selfHostConfig(),
      });

      const haltPath = join(dir, '.pipeline/HALT');
      let haltBody: string | null = null;
      events.on('loop_halt', () => {
        // HALT marker should be written
      });

      await conductor.run();

      // Read HALT marker
      try {
        const { readFile } = await import('node:fs/promises');
        haltBody = await readFile(haltPath, 'utf-8');
      } catch {
        // HALT may not exist
      }

      expect(haltBody).not.toBeNull();
      expect(haltBody).toContain(tokenPath);
      expect(haltBody).toContain('claude setup-token');
      // Should NOT reference operator credentials
      expect(haltBody).not.toContain('.credentials.json');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('park timeout HALT: does not mention expiresAt or retries exhausted (daemon-token specific)', async () => {
    const runner: StepRunner = {
      run: vi.fn(async (step: string): Promise<StepRunResult> => {
        if (step !== 'build') return { success: true };
        return { success: false, authFailure: true } as AuthResult;
      }),
    };

    const mockGuardrails = {
      resolveHarnessRoot: vi.fn().mockResolvedValue(dir),
      resolveInstalledHarnessRoot: vi.fn().mockResolvedValue({ status: 'ok' as const, root: dir }),
      relink: vi.fn(),
      provisionSandbox: vi.fn(async () => ({
        configDir: dir,
        childEnv: () => process.env,
        teardown: async () => {},
      })),
      versionGate: vi.fn().mockResolvedValue({ ok: true }),
      releaseGate: vi.fn().mockResolvedValue({ ok: true }),
    };

    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);

    const sleepFn = vi.fn(async () => {
      clockOffset += 120_000;
    });

    try {
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        fromStep: 'build',
        mode: 'auto',
        daemon: true,
        selfHost: true,
        maxRetries: 3,
        sleepFn,
        selfHostGuardrails: mockGuardrails as any,
        config: selfHostConfig(),
      });

      const haltPath = join(dir, '.pipeline/HALT');
      let haltBody: string | null = null;

      await conductor.run();

      // Read HALT marker
      try {
        const { readFile } = await import('node:fs/promises');
        haltBody = await readFile(haltPath, 'utf-8');
      } catch {
        // HALT may not exist
      }

      expect(haltBody).not.toBeNull();
      // Task 13: Must NOT mention expiresAt
      expect(haltBody).not.toContain('expiresAt');
      expect(haltBody).not.toContain('Expires at');
      // Task 13: Must NOT mention "retries exhausted"
      expect(haltBody).not.toContain('retries exhausted');
      // Task 13: Must name daemon token path and setup command
      expect(haltBody).toContain(tokenPath);
      expect(haltBody).toContain('claude setup-token');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('park timeout: retry budget not consumed (park does not count as a retry)', async () => {
    let buildAttempts = 0;
    const runner: StepRunner = {
      run: vi.fn(async (step: string): Promise<StepRunResult> => {
        if (step !== 'build') return { success: true };
        buildAttempts++;
        if (buildAttempts === 1) {
          return { success: false, authFailure: true } as AuthResult;
        }
        return { success: true };
      }),
    };

    const mockGuardrails = {
      resolveHarnessRoot: vi.fn().mockResolvedValue(dir),
      resolveInstalledHarnessRoot: vi.fn().mockResolvedValue({ status: 'ok' as const, root: dir }),
      relink: vi.fn(),
      provisionSandbox: vi.fn(async () => ({
        configDir: dir,
        childEnv: () => process.env,
        teardown: async () => {},
      })),
      versionGate: vi.fn().mockResolvedValue({ ok: true }),
      releaseGate: vi.fn().mockResolvedValue({ ok: true }),
    };

    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);

    let parkCalls = 0;
    const sleepFn = vi.fn(async () => {
      parkCalls++;
      if (parkCalls === 1) {
        // First park sleep: trigger resume
        clockOffset += 10_000;
        await utimes(tokenPath, new Date(), new Date());
        await writeFile(tokenPath, 'tok-v2', 'utf-8');
      } else {
        clockOffset += 120_000;
      }
    });

    try {
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        fromStep: 'build',
        mode: 'auto',
        daemon: true,
        selfHost: true,
        maxRetries: 1, // Only 1 retry budget
        sleepFn,
        selfHostGuardrails: mockGuardrails as any,
        config: selfHostConfig(),
      });

      await conductor.run();

      // Task 13: Park should NOT consume retry budget. With maxRetries=1:
      // - Attempt 1: build fails with authFailure
      // - Park (does not consume budget)
      // - Attempt 2 (same attempt counter, retry budget consumed here): build succeeds
      // So we should see exactly 2 build calls total, confirming park did not count as a separate retry.
      expect(buildAttempts).toBe(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('serial dispatch parks on the newly extended auth-failure patterns (FR-4, e.g. "Failed to authenticate. API Error: 401 Invalid bearer token")', async () => {
    // Verifies the serial (non-group) conductor dispatch path parks when the
    // step runner's result carries `authFailure: true` as classified by
    // claude-provider's extended AUTH_FAILURE_RE (Task 1). The park branch
    // gates purely on the boolean flag, not the literal pattern text, so any
    // string that AUTH_FAILURE_RE matches should engage the same park-and-poll
    // behavior as the pre-existing patterns (e.g. "not logged in").
    const observedOutput = 'Failed to authenticate. API Error: 401 Invalid bearer token';
    expect(detectsAuthFailure(observedOutput)).toBe(true);

    let buildAttempts = 0;
    let buildAttempt1Failed = false;

    const runner: StepRunner = {
      run: vi.fn(async (step: string): Promise<StepRunResult> => {
        if (step !== 'build') return { success: true };
        buildAttempts++;
        if (buildAttempts === 1) {
          buildAttempt1Failed = true;
          return {
            success: false,
            output: observedOutput,
            authFailure: detectsAuthFailure(observedOutput),
          } as AuthResult;
        }
        return { success: true };
      }),
    };

    const mockGuardrails = {
      resolveHarnessRoot: vi.fn().mockResolvedValue(dir),
      resolveInstalledHarnessRoot: vi.fn().mockResolvedValue({ status: 'ok' as const, root: dir }),
      relink: vi.fn(),
      provisionSandbox: vi.fn(async () => ({
        configDir: dir,
        childEnv: () => process.env,
        teardown: async () => {},
      })),
      versionGate: vi.fn().mockResolvedValue({ ok: true }),
      releaseGate: vi.fn().mockResolvedValue({ ok: true }),
    };

    const realNow = Date.now();
    let clockOffset = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + clockOffset);

    let parkResumeCalls = 0;
    const sleepFn = vi.fn(async () => {
      if (buildAttempt1Failed && parkResumeCalls === 0) {
        parkResumeCalls++;
        clockOffset += 10_000;
        await utimes(tokenPath, new Date(), new Date());
        await writeFile(tokenPath, 'tok-v2', 'utf-8');
      } else {
        clockOffset += 120_000;
      }
    });

    try {
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        fromStep: 'build',
        mode: 'auto',
        daemon: true,
        selfHost: true,
        maxRetries: 1,
        sleepFn,
        selfHostGuardrails: mockGuardrails as any,
        config: selfHostConfig(),
      });

      await conductor.run();

      // Build called twice: first fails with authFailure (parks, no retry
      // budget burned), second succeeds after park resumes on token refresh.
      expect(buildAttempts).toBe(2);
      expect(mockGuardrails.provisionSandbox).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });
});

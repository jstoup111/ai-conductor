/**
 * Acceptance specs for .docs/stories/sandbox-auth-expiry-park.md (TR-1..TR-5):
 * "auth failures/expired credentials park-and-poll on the operator credentials
 * file instead of burning the retry budget or HALTing as a build defect."
 *
 * Drives the REAL Conductor step loop (`Conductor.run()`) through the
 * self-host `build` step dispatch — the actual production entry point named
 * by the stories ("when the conductor handles it" / "when a self-host build
 * attempt would dispatch" / "when the step finishes"). Per-call-site unit
 * behavior (AUTH_FAILURE_RE matching, the credentials reader's fail-open
 * shapes, resolved-config validation) is unit-level and belongs to
 * test/execution/claude-provider.test.ts, test/engine/self-host/
 * operator-credentials.test.ts, and test/engine/resolved-config.test.ts
 * written during /pipeline — this file only covers the cross-module park ->
 * refresh -> resume flow the stories describe end to end.
 *
 * Pre-implementation: today the conductor has no `authFailure` branch and no
 * pre-flight credentials check, so every scenario below fails for the right
 * reason (the auth failure is treated as an ordinary step failure that either
 * burns the retry budget or HALTs with the generic "retries exhausted"
 * reason) until Tasks 1-16 of the plan are implemented.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import type { SelfHostGuardrails } from '../../src/engine/self-host/wiring.js';
import { HALT_MARKER } from '../../src/engine/halt-marker.js';

/** The story's flag is not yet on StepRunResult — overlay it locally. */
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

async function writeOperatorCreds(
  operatorDir: string,
  expiresAt: number,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await writeFile(
    join(operatorDir, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { expiresAt }, ...extra }),
    'utf-8',
  );
}

describe('acceptance: sandbox auth-expiry park-and-poll (sandbox-auth-expiry-park)', () => {
  let dir: string;
  let statePath: string;
  let operatorDir: string;
  let events: ConductorEventEmitter;
  let priorConfigDir: string | undefined;
  let provisionedDirs: string[];
  // Sandbox teardown (TR-5) removes the config dir on every exit path, so the
  // sandbox's credentials copy must be captured at teardown time to be asserted.
  let sandboxCredsAtTeardown: string | null;

  function makeGuardrails(): SelfHostGuardrails {
    return {
      resolveHarnessRoot: async () => dir,
      relink: async () => {},
      provisionSandbox: vi.fn(async () => {
        const configDir = await mkdtemp(join(tmpdir(), 'sandbox-'));
        provisionedDirs.push(configDir);
        await writeFile(
          join(configDir, '.credentials.json'),
          await readFile(join(operatorDir, '.credentials.json'), 'utf-8').catch(() => 'initial'),
          'utf-8',
        ).catch(() => {});
        return {
          configDir,
          childEnv: () => process.env,
          teardown: async () => {
            sandboxCredsAtTeardown = await readFile(
              join(configDir, '.credentials.json'),
              'utf-8',
            ).catch(() => null);
            await rm(configDir, { recursive: true, force: true });
          },
        };
      }),
      versionGate: async () => ({ ok: true }),
      releaseGate: async () => ({ ok: true }),
    };
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'auth-park-acceptance-'));
    operatorDir = await mkdtemp(join(tmpdir(), 'auth-park-operator-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    provisionedDirs = [];
    sandboxCredsAtTeardown = null;
    priorConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = operatorDir;
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeState(statePath, READY_STATE);
  });

  afterEach(async () => {
    if (priorConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = priorConfigDir;
    await rm(dir, { recursive: true, force: true });
    await rm(operatorDir, { recursive: true, force: true });
    for (const p of provisionedDirs) await rm(p, { recursive: true, force: true }).catch(() => {});
  });

  async function haltBody(): Promise<string | null> {
    return readFile(join(dir, HALT_MARKER), 'utf-8').catch(() => null);
  }

  it('TR-3 happy: authFailure parks, credentials refresh re-copies into the SAME sandbox, resumes with zero retry-budget burn — even across a repeated auth failure', async () => {
    await writeOperatorCreds(operatorDir, Date.now() + 3_600_000); // fresh — isolates from TR-2 pre-flight
    let generation = 0;

    let buildCalls = 0;
    const runner: StepRunner = {
      run: vi.fn(async (step): Promise<StepRunResult> => {
        if (step !== 'build') return { success: true };
        buildCalls++;
        // Rotated-but-invalid token: pre-flight sees a fresh expiresAt but the
        // real invocation still fails twice before a genuine refresh lands.
        if (buildCalls <= 2) return { success: false, authFailure: true } as AuthResult;
        return { success: true };
      }),
    };

    const sleepFn = vi.fn(async () => {
      generation++;
      await writeOperatorCreds(operatorDir, Date.now() + 3_600_000, { gen: generation });
    });

    const guardrails = makeGuardrails();
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      daemon: true,
      selfHost: true,
      maxRetries: 1, // budget would be exhausted by even ONE incorrectly-charged park
      sleepFn,
      selfHostGuardrails: guardrails,
    });

    await conductor.run();

    expect(buildCalls).toBe(3);
    expect(await haltBody()).toBeNull(); // never parked-out to HALT
    expect(guardrails.provisionSandbox).toHaveBeenCalledTimes(1); // reused, not re-provisioned

    expect(sandboxCredsAtTeardown).not.toBeNull();
    const sandboxCreds = JSON.parse(sandboxCredsAtTeardown as string);
    const operatorCreds = JSON.parse(
      await readFile(join(operatorDir, '.credentials.json'), 'utf-8'),
    );
    // Mandatory re-copy: the reused sandbox's copy must track the operator's
    // LATEST refreshed generation, never the stale one captured at provision time.
    expect(sandboxCreds.gen).toBe(operatorCreds.gen);
    expect(sandboxCreds.gen).toBeGreaterThan(0);
  });

  it('TR-2 happy: expired credentials park BEFORE provisioning or spawning anything, then dispatch proceeds once refreshed', async () => {
    await writeOperatorCreds(operatorDir, Date.now() - 1000); // expired

    const runner: StepRunner = {
      run: vi.fn(async (step): Promise<StepRunResult> => {
        if (step !== 'build') return { success: true };
        return { success: true };
      }),
    };

    const sleepFn = vi.fn(async () => {
      await writeOperatorCreds(operatorDir, Date.now() + 3_600_000);
    });

    const guardrails = makeGuardrails();
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
      selfHostGuardrails: guardrails,
    });

    await conductor.run();

    expect(await haltBody()).toBeNull();
    // The pre-flight must park BEFORE provisioning: exactly one provision, and
    // it happens only once the refresh has landed (never eagerly on an expired file).
    expect(guardrails.provisionSandbox).toHaveBeenCalledTimes(1);
    const buildDispatches = (runner.run as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([step]) => step === 'build',
    );
    expect(buildDispatches).toHaveLength(1); // retry budget untouched — one dispatch
  });

  it.each([
    ['missing credentials file', async () => {}],
    ['malformed JSON', async () => writeFile(join(operatorDir, '.credentials.json'), '{not json', 'utf-8')],
    [
      'well-formed JSON without a claudeAiOauth block',
      async () => writeFile(join(operatorDir, '.credentials.json'), JSON.stringify({ other: 1 }), 'utf-8'),
    ],
  ])('TR-2 negative (fail-open): %s never parks — dispatch proceeds normally', async (_label, seed) => {
    await seed();

    const runner: StepRunner = {
      run: vi.fn(async (): Promise<StepRunResult> => ({ success: true })),
    };
    const sleepFn = vi.fn(async () => {});
    const guardrails = makeGuardrails();

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
      selfHostGuardrails: guardrails,
    });

    await conductor.run();

    expect(sleepFn).not.toHaveBeenCalled(); // fail-open: no park loop entered at all
    expect(guardrails.provisionSandbox).toHaveBeenCalledTimes(1);
    expect(await haltBody()).toBeNull();
  });

  it('TR-4 + TR-5 negative: auth_park_timeout_minutes <= 0 opts out — immediate credentials-specific HALT, no poll loop, reason is never "retries exhausted"', async () => {
    const expiresAt = Date.now() - 1000;
    await writeOperatorCreds(operatorDir, expiresAt);

    const runner: StepRunner = {
      run: vi.fn(async (): Promise<StepRunResult> => ({ success: true })),
    };
    const sleepFn = vi.fn(async () => {});
    const guardrails = makeGuardrails();

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
      selfHostGuardrails: guardrails,
      config: { harness_self_host: { auth_park_timeout_minutes: 0 } } as never,
    });

    await conductor.run();

    expect(sleepFn).not.toHaveBeenCalled(); // opt-out: no poll loop at all
    expect(guardrails.provisionSandbox).not.toHaveBeenCalled(); // never dispatched
    expect(runner.run).not.toHaveBeenCalled();

    const body = await haltBody();
    expect(body).not.toBeNull();
    expect(body).not.toMatch(/retries exhausted/i);
    // Names the credentials file and the observed expiry so the operator reads
    // this as an auth-window condition, not a build defect (TR-4 Done When).
    expect(body).toContain(join(operatorDir, '.credentials.json'));
    expect(body).toContain(String(expiresAt));
  });
});

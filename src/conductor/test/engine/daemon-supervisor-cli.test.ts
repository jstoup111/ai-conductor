import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TmuxNotInstalledError } from '../../src/engine/daemon-tmux.js';
import { isPaused } from '../../src/engine/pause-marker.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED specs for the NOT-YET-BUILT module src/engine/daemon-supervisor-cli.ts
// (ADR-014, Batch 2, daemon-supervised-hosting).
//
// Contract: dispatchDaemonSupervisor({verb}, { supervisor, cwd, out })
//   → Promise<number>  (exit code)
//
// All tests dynamically import the module inside the test body — a missing
// module surfaces as THAT test's own RED failure (ERR_MODULE_NOT_FOUND).
// No real tmux is spawned; the injected fake supervisor records calls.
//
// Verb → supervisor method mapping:
//   start   → supervisor.start(cwd)
//   stop    → supervisor.stop(cwd)
//   restart → supervisor.restart(cwd)
//   connect → supervisor.attach(cwd, {readOnly:true})
//   debug   → supervisor.attach(cwd, {readOnly:false})
// ─────────────────────────────────────────────────────────────────────────────

const CLI_MOD = '../../src/engine/daemon-supervisor-cli.js';

async function load(): Promise<Record<string, unknown>> {
  // Throws ERR_MODULE_NOT_FOUND (RED) when the module does not exist yet.
  return (await import(CLI_MOD)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fake supervisor — records { method, args } for each call; optionally throws.
// Pass throwOn to make a specific method throw a given error.
// ─────────────────────────────────────────────────────────────────────────────
type MethodCall = { method: string; args: unknown[] };

function makeFakeSupervisor(throwOn?: { method: string; error: Error }): {
  calls: MethodCall[];
  supervisor: Record<string, (...args: any[]) => Promise<void | string | boolean>>;
} {
  const calls: MethodCall[] = [];
  const makeMethod = (method: string) =>
    async (...args: unknown[]): Promise<void> => {
      calls.push({ method, args });
      if (throwOn?.method === method) throw throwOn.error;
    };
  // restart returns a RestartOutcome ({ degraded, message }) per the Supervisor
  // port contract (FR-20 neg, Task 24) rather than void.
  const restart = async (...args: unknown[]): Promise<{ degraded: boolean; message: string }> => {
    calls.push({ method: 'restart', args });
    if (throwOn?.method === 'restart') throw throwOn.error;
    return { degraded: false, message: 'daemon restarted in place (session preserved).' };
  };
  return {
    calls,
    supervisor: {
      start: makeMethod('start'),
      stop: makeMethod('stop'),
      restart,
      attach: makeMethod('attach'),
      logs: makeMethod('logs'),
      exec: makeMethod('exec'),
      isUp: makeMethod('isUp'),
    },
  };
}

const CWD = '/repo/my-project';

// ═════════════════════════════════════════════════════════════════════════════
// Verb → supervisor method routing + exit code 0 on success
// ═════════════════════════════════════════════════════════════════════════════
describe('dispatchDaemonSupervisor: verb → supervisor method routing', () => {
  it('start → supervisor.start(cwd), returns 0', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const { calls, supervisor } = makeFakeSupervisor();
    const out: string[] = [];

    const code: number = await dispatch(
      { verb: 'start' },
      // ensureFresh no-op: this test exercises verb→method routing, not the
      // install-freshness gate (covered in install-freshness.test.ts).
      { supervisor, cwd: CWD, out: (l: string) => out.push(l), ensureFresh: async () => {} },
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('start');
    expect(calls[0].args[0]).toBe(CWD);
  });

  it('stop → supervisor.stop(cwd), returns 0', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const { calls, supervisor } = makeFakeSupervisor();
    const out: string[] = [];

    const code: number = await dispatch(
      { verb: 'stop' },
      { supervisor, cwd: CWD, out: (l: string) => out.push(l) },
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('stop');
    expect(calls[0].args[0]).toBe(CWD);
  });

  it('restart → supervisor.restart(cwd), returns 0', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const { calls, supervisor } = makeFakeSupervisor();
    const out: string[] = [];

    const code: number = await dispatch(
      { verb: 'restart' },
      { supervisor, cwd: CWD, out: (l: string) => out.push(l) },
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('restart');
    expect(calls[0].args[0]).toBe(CWD);
  });

  it('connect → supervisor.attach(cwd, {readOnly:true}), returns 0', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const { calls, supervisor } = makeFakeSupervisor();
    const out: string[] = [];

    const code: number = await dispatch(
      { verb: 'connect' },
      { supervisor, cwd: CWD, out: (l: string) => out.push(l) },
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('attach');
    expect(calls[0].args[0]).toBe(CWD);
    expect(calls[0].args[1]).toMatchObject({ readOnly: true });
  });

  it('debug → supervisor.attach(cwd, {readOnly:false}), returns 0', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const { calls, supervisor } = makeFakeSupervisor();
    const out: string[] = [];

    const code: number = await dispatch(
      { verb: 'debug' },
      { supervisor, cwd: CWD, out: (l: string) => out.push(l) },
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('attach');
    expect(calls[0].args[0]).toBe(CWD);
    expect(calls[0].args[1]).toMatchObject({ readOnly: false });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// start auto-attach: interactive start drops into the session (read-only) unless
// -D (detach) or no interactive terminal.
// ═════════════════════════════════════════════════════════════════════════════
describe('dispatchDaemonSupervisor: start auto-attach', () => {
  it('interactive start (no detach) → start THEN attach({readOnly:true})', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const { calls, supervisor } = makeFakeSupervisor();
    const out: string[] = [];

    const code: number = await dispatch(
      { verb: 'start' },
      { supervisor, cwd: CWD, out: (l: string) => out.push(l), isInteractive: true, ensureFresh: async () => {} },
    );

    expect(code).toBe(0);
    expect(calls.map((c) => c.method)).toEqual(['start', 'attach']);
    expect(calls[0].args[0]).toBe(CWD);
    expect(calls[1].args[0]).toBe(CWD);
    expect(calls[1].args[1]).toMatchObject({ readOnly: true });
  });

  it('interactive start WITH detach (-D) → start only, notes how to attach', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const { calls, supervisor } = makeFakeSupervisor();
    const out: string[] = [];

    const code: number = await dispatch(
      { verb: 'start', detach: true },
      { supervisor, cwd: CWD, out: (l: string) => out.push(l), isInteractive: true, ensureFresh: async () => {} },
    );

    expect(code).toBe(0);
    expect(calls.map((c) => c.method)).toEqual(['start']); // no attach
    expect(out.join('\n')).toMatch(/detached|connect/i);
  });

  it('non-interactive start → start only (never blocks on tmux attach)', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const { calls, supervisor } = makeFakeSupervisor();
    const out: string[] = [];

    const code: number = await dispatch(
      { verb: 'start' },
      { supervisor, cwd: CWD, out: (l: string) => out.push(l), isInteractive: false, ensureFresh: async () => {} },
    );

    expect(code).toBe(0);
    expect(calls.map((c) => c.method)).toEqual(['start']); // no attach
    expect(out.join('\n')).toMatch(/connect/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TmuxNotInstalledError handling — returns 1 + actionable /tmux/i message
// ═════════════════════════════════════════════════════════════════════════════
describe('dispatchDaemonSupervisor: TmuxNotInstalledError handling', () => {
  it('returns 1 and writes a /tmux/i message to out when supervisor throws TmuxNotInstalledError', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const { supervisor } = makeFakeSupervisor({
      method: 'start',
      error: new TmuxNotInstalledError(),
    });
    const out: string[] = [];

    const code: number = await dispatch(
      { verb: 'start' },
      // ensureFresh no-op so the TmuxNotInstalledError path (not the freshness
      // gate) is what this test exercises.
      { supervisor, cwd: CWD, out: (l: string) => out.push(l), ensureFresh: async () => {} },
    );

    expect(code).toBe(1);
    expect(out.length).toBeGreaterThan(0);
    expect(out.join('\n')).toMatch(/tmux/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Generic Error from attach — returns non-zero + forwards message (FR-9)
// ═════════════════════════════════════════════════════════════════════════════
describe('dispatchDaemonSupervisor: generic Error from attach forwards message (FR-9)', () => {
  it('returns non-zero and forwards the error message to out when attach throws (connect verb)', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const sessionError = new Error(
      'No daemon session found for "/repo/my-project". Run \'conduct-ts daemon start\' first.',
    );
    const { supervisor } = makeFakeSupervisor({ method: 'attach', error: sessionError });
    const out: string[] = [];

    const code: number = await dispatch(
      { verb: 'connect' },
      { supervisor, cwd: CWD, out: (l: string) => out.push(l) },
    );

    expect(code).not.toBe(0);
    expect(out.length).toBeGreaterThan(0);
    expect(out.join('\n')).toMatch(/No daemon session/);
  });

  it('returns non-zero and forwards the error message to out when attach throws (debug verb)', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const sessionError = new Error(
      'No daemon session found for "/repo/my-project". Run \'conduct-ts daemon start\' first.',
    );
    const { supervisor } = makeFakeSupervisor({ method: 'attach', error: sessionError });
    const out: string[] = [];

    const code: number = await dispatch(
      { verb: 'debug' },
      { supervisor, cwd: CWD, out: (l: string) => out.push(l) },
    );

    expect(code).not.toBe(0);
    expect(out.join('\n')).toMatch(/No daemon session/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// pause / resume — write/remove the .daemon/PAUSED marker for the cwd repo
// (FR-1/FR-2, Task 16). Not supervisor methods: no fake supervisor call expected.
// ═════════════════════════════════════════════════════════════════════════════
describe('dispatchDaemonSupervisor: pause/resume drive the pause marker, not the supervisor', () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });
  async function tempRepo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'daemon-cli-pause-'));
    tempDirs.push(dir);
    return dir;
  }

  it('pause writes the pause marker and returns 0', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const repo = await tempRepo();
    const { calls, supervisor } = makeFakeSupervisor();
    const out: string[] = [];

    const code: number = await dispatch(
      { verb: 'pause' },
      { supervisor, cwd: repo, out: (l: string) => out.push(l) },
    );

    expect(code).toBe(0);
    expect(await isPaused(repo)).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('pause-when-already-paused is idempotent and reports "already paused"', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const repo = await tempRepo();
    const { supervisor } = makeFakeSupervisor();
    const out: string[] = [];

    await dispatch({ verb: 'pause' }, { supervisor, cwd: repo, out: (l: string) => out.push(l) });
    const code: number = await dispatch(
      { verb: 'pause' },
      { supervisor, cwd: repo, out: (l: string) => out.push(l) },
    );

    expect(code).toBe(0);
    expect(await isPaused(repo)).toBe(true);
    expect(out.join('\n')).toMatch(/already paused/);
  });

  it('resume removes the pause marker and returns 0', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const repo = await tempRepo();
    const { calls, supervisor } = makeFakeSupervisor();
    const out: string[] = [];

    await dispatch({ verb: 'pause' }, { supervisor, cwd: repo, out: (l: string) => out.push(l) });
    const code: number = await dispatch(
      { verb: 'resume' },
      { supervisor, cwd: repo, out: (l: string) => out.push(l) },
    );

    expect(code).toBe(0);
    expect(await isPaused(repo)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('resume-when-not-paused is idempotent and reports "not paused"', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const repo = await tempRepo();
    const { supervisor } = makeFakeSupervisor();
    const out: string[] = [];

    const code: number = await dispatch(
      { verb: 'resume' },
      { supervisor, cwd: repo, out: (l: string) => out.push(l) },
    );

    expect(code).toBe(0);
    expect(await isPaused(repo)).toBe(false);
    expect(out.join('\n')).toMatch(/not paused/);
  });

  it('alternation converges: pause → resume → pause leaves the marker present', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const repo = await tempRepo();
    const { supervisor } = makeFakeSupervisor();
    const out: string[] = [];
    const run = (verb: 'pause' | 'resume') =>
      dispatch({ verb }, { supervisor, cwd: repo, out: (l: string) => out.push(l) });

    expect(await run('pause')).toBe(0);
    expect(await isPaused(repo)).toBe(true);

    expect(await run('resume')).toBe(0);
    expect(await isPaused(repo)).toBe(false);

    expect(await run('pause')).toBe(0);
    expect(await isPaused(repo)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// restart — idle vs paused vs busy (FR-9, Task 27)
//
//   idle    → immediate respawn (unchanged: supervisor.restart(cwd) fires)
//   paused  → immediate respawn (paused counts as idle, FR-11); pause marker
//             itself is untouched by restart
//   busy    → NEVER calls supervisor.restart; instead writes the durable
//             `.daemon/RESTART-PENDING` marker (restart-marker.ts, Task 26)
//             naming the blocking slug, exits 0 immediately, and the output
//             names the blocking feature.
// ═════════════════════════════════════════════════════════════════════════════
describe('dispatchDaemonSupervisor: restart — immediate (idle/paused) vs queued (busy)', () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });
  async function tempRepo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'daemon-cli-restart-'));
    tempDirs.push(dir);
    return dir;
  }

  it('idle → immediate respawn: supervisor.restart(cwd) is called, no marker written', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const { consumeOnBoot } = await import('../../src/engine/restart-marker.js');
    const repo = await tempRepo();
    const { calls, supervisor } = makeFakeSupervisor();
    const out: string[] = [];

    const code: number = await dispatch(
      { verb: 'restart' },
      { supervisor, cwd: repo, out: (l: string) => out.push(l) },
    );

    expect(code).toBe(0);
    expect(calls.map((c) => c.method)).toEqual(['restart']);
    expect(await (consumeOnBoot as (r: string) => Promise<unknown>)(repo)).toBeNull();
  });

  it('paused → immediate respawn (paused counts as idle); pause marker is left untouched', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const { writePauseMarker } = await import('../../src/engine/pause-marker.js');
    const repo = await tempRepo();
    await writePauseMarker(repo, { pausedBy: 'test-operator' });
    const { calls, supervisor } = makeFakeSupervisor();
    const out: string[] = [];

    const code: number = await dispatch(
      { verb: 'restart' },
      { supervisor, cwd: repo, out: (l: string) => out.push(l) },
    );

    expect(code).toBe(0);
    expect(calls.map((c) => c.method)).toEqual(['restart']);
    expect(await isPaused(repo)).toBe(true); // untouched by restart
  });

  it('busy → marker written naming the blocking slug, exits 0, never calls supervisor.restart', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const { consumeOnBoot } = await import('../../src/engine/restart-marker.js');
    const repo = await tempRepo();
    const { calls, supervisor } = makeFakeSupervisor();
    const out: string[] = [];

    const code: number = await dispatch(
      { verb: 'restart' },
      {
        supervisor,
        cwd: repo,
        out: (l: string) => out.push(l),
        isBusy: async () => ({ busy: true, blockingSlug: 'feature-in-flight' }),
      },
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(0); // no tmux respawn — the daemon fires it later
    expect(out.join('\n')).toMatch(/feature-in-flight/);

    const intent = await (consumeOnBoot as (r: string) => Promise<{ blockingSlug?: string } | null>)(
      repo,
    );
    expect(intent).toBeTruthy();
    expect(intent!.blockingSlug).toBe('feature-in-flight');
  });

  it('busy while paused is impossible per contract: paused short-circuits before isBusy is consulted', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const { writePauseMarker } = await import('../../src/engine/pause-marker.js');
    const repo = await tempRepo();
    await writePauseMarker(repo, { pausedBy: 'test-operator' });
    const { calls, supervisor } = makeFakeSupervisor();
    const out: string[] = [];
    let isBusyCalled = false;

    const code: number = await dispatch(
      { verb: 'restart' },
      {
        supervisor,
        cwd: repo,
        out: (l: string) => out.push(l),
        isBusy: async () => {
          isBusyCalled = true;
          return { busy: true, blockingSlug: 'should-never-surface' };
        },
      },
    );

    expect(code).toBe(0);
    expect(isBusyCalled).toBe(false);
    expect(calls.map((c) => c.method)).toEqual(['restart']); // immediate, not queued
  });

  it('idle → relink called before supervisor.restart (TR-4)', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const repo = await tempRepo();
    const { calls, supervisor } = makeFakeSupervisor();
    const out: string[] = [];
    const callOrder: string[] = [];

    // Mock relinkSkillsForSelfBuild
    const mockRelink = async () => {
      callOrder.push('relink');
    };

    // Wrap the supervisor.restart to track when it's called
    const originalRestart = supervisor.restart;
    supervisor.restart = async (...args: unknown[]) => {
      callOrder.push('restart');
      return originalRestart.apply(supervisor, args);
    };

    const code: number = await dispatch(
      { verb: 'restart' },
      {
        supervisor,
        cwd: repo,
        out: (l: string) => out.push(l),
        relinkSkills: mockRelink,
      },
    );

    expect(code).toBe(0);
    expect(callOrder).toEqual(['relink', 'restart']);
  });
});

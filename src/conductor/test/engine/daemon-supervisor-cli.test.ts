import { describe, it, expect } from 'vitest';
import { TmuxNotInstalledError } from '../../src/engine/daemon-tmux.js';

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
  return {
    calls,
    supervisor: {
      start: makeMethod('start'),
      stop: makeMethod('stop'),
      restart: makeMethod('restart'),
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

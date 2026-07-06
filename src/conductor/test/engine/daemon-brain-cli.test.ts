// daemon-brain-cli.test.ts — RED specs for the NOT-YET-BUILT module
// src/engine/brain-supervisor-cli.ts (Task 18, background-intake-conduct-loop).
//
// Contract:
//   brainStart(deps)  → Promise<number>   creates/reuses the `cc-brain-*` tmux
//                        session running `conduct-ts intake-loop --continuous`
//   brainStop(deps)   → Promise<number>   kills the brain session
//   brainStatus(deps) → Promise<number>   reports liveness + queued-work count
//
// No real tmux is spawned — a fake TmuxRunner records argv and returns
// deterministic results. No real filesystem I/O — a fake readStatus is
// injected for the intake-status.json read.

import { describe, it, expect } from 'vitest';

const MOD = '../../src/engine/brain-supervisor-cli.js';

async function load(): Promise<Record<string, unknown>> {
  return (await import(MOD)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

type Call = { args: string[] };

/** Fake TmuxRunner — records every invocation; `sessions` tracks live session names. */
function makeFakeTmuxRunner(initiallyUp: string[] = []) {
  const calls: Call[] = [];
  const sessions = new Set(initiallyUp);
  const run = (args: string[], _opts: { inherit: boolean }) => {
    calls.push({ args });
    if (args[0] === 'has-session') {
      const target = args[2]?.replace(/^=/, '') ?? '';
      return { code: sessions.has(target) ? 0 : 1, stdout: '' };
    }
    if (args[0] === 'new-session') {
      const sIdx = args.indexOf('-s');
      const name = sIdx >= 0 ? args[sIdx + 1] : undefined;
      if (name) sessions.add(name);
      return { code: 0, stdout: '' };
    }
    if (args[0] === 'kill-session') {
      const target = args[2]?.replace(/^=/, '') ?? '';
      sessions.delete(target);
      return { code: 0, stdout: '' };
    }
    return { code: 0, stdout: '' };
  };
  return { calls, sessions, run };
}

describe('brainStart', () => {
  it('creates a cc-brain-* tmux session running conduct-ts intake-loop --continuous', async () => {
    const mod = await load();
    const brainStart = requireFn(mod, 'brainStart');
    const { calls, run } = makeFakeTmuxRunner();
    const out: string[] = [];

    const code = await brainStart({ run, cwd: '/repo', out: (l: string) => out.push(l) });

    expect(code).toBe(0);
    const newSessionCall = calls.find((c) => c.args[0] === 'new-session');
    expect(newSessionCall).toBeTruthy();
    const sIdx = newSessionCall!.args.indexOf('-s');
    const sessionName = newSessionCall!.args[sIdx + 1];
    expect(sessionName).toMatch(/^cc-brain-/);
    expect(newSessionCall!.args).toContain('conduct-ts intake-loop --continuous');
  });

  it('is idempotent: calling start twice does not create two sessions', async () => {
    const mod = await load();
    const brainStart = requireFn(mod, 'brainStart');
    const { calls, run } = makeFakeTmuxRunner();
    const out: string[] = [];

    await brainStart({ run, cwd: '/repo', out: (l: string) => out.push(l) });
    await brainStart({ run, cwd: '/repo', out: (l: string) => out.push(l) });

    const newSessionCalls = calls.filter((c) => c.args[0] === 'new-session');
    expect(newSessionCalls).toHaveLength(1);
    expect(out.join('\n')).toMatch(/already running/i);
  });
});

describe('brainStop', () => {
  it('kills the running brain session', async () => {
    const mod = await load();
    const brainStart = requireFn(mod, 'brainStart');
    const brainStop = requireFn(mod, 'brainStop');
    const { calls, sessions, run } = makeFakeTmuxRunner();
    const out: string[] = [];

    await brainStart({ run, cwd: '/repo', out: (l: string) => out.push(l) });
    const code = await brainStop({ run, out: (l: string) => out.push(l) });

    expect(code).toBe(0);
    expect(calls.some((c) => c.args[0] === 'kill-session')).toBe(true);
    expect(sessions.size).toBe(0);
  });

  it('stop when nothing is running is a graceful no-op', async () => {
    const mod = await load();
    const brainStop = requireFn(mod, 'brainStop');
    const { run } = makeFakeTmuxRunner();
    const out: string[] = [];

    const code = await brainStop({ run, out: (l: string) => out.push(l) });

    expect(code).toBe(0);
  });
});

describe('brainStatus', () => {
  it('reports running + queued count from the status surface when the session is up', async () => {
    const mod = await load();
    const brainStart = requireFn(mod, 'brainStart');
    const brainStatus = requireFn(mod, 'brainStatus');
    const { run } = makeFakeTmuxRunner();
    const out: string[] = [];

    await brainStart({ run, cwd: '/repo', out: () => {} });
    const code = await brainStatus({
      run,
      out: (l: string) => out.push(l),
      readStatus: async () => JSON.stringify({ count: 3, sourceRefs: ['a', 'b', 'c'] }),
    });

    expect(code).toBe(0);
    expect(out.join('\n')).toMatch(/running/i);
    expect(out.join('\n')).toMatch(/3/);
  });

  it('reports stopped + zero queued when no session and no status surface', async () => {
    const mod = await load();
    const brainStatus = requireFn(mod, 'brainStatus');
    const { run } = makeFakeTmuxRunner();
    const out: string[] = [];

    const code = await brainStatus({
      run,
      out: (l: string) => out.push(l),
      readStatus: async () => null,
    });

    expect(code).toBe(0);
    expect(out.join('\n')).toMatch(/stopped/i);
    expect(out.join('\n')).toMatch(/0/);
  });
});

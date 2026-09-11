// daemon-brain-cli.test.ts — RED specs for the NOT-YET-BUILT module
// src/engine/brain-supervisor-cli.ts (Task 18, background-intake-conduct-loop).
//
// Contract:
//   brainStart(deps)  → Promise<number>   creates/reuses the `cc-brain-*` tmux
//                        session running `ai-conductor intake-loop --continuous`
//   brainStop(deps)   → Promise<number>   kills the brain session
//   brainStatus(deps) → Promise<number>   reports liveness + durable queue depth
//
// No real tmux is spawned — a fake TmuxRunner records argv and returns
// deterministic results. No real filesystem I/O — a fake readStatus is
// injected for the intake-status.json read.

import { describe, it, expect } from 'vitest';
import { CorruptLedgerError } from '../../src/engine/engineer/intake/ledger.js';

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
  it('creates a cc-brain-* tmux session running the canonical intake-loop launcher', async () => {
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
    expect(newSessionCall!.args.at(-1)).toMatch(/bin\/ai-conductor.* intake-loop --continuous$/);
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
  const now = Date.UTC(2026, 8, 11, 12, 0, 0);
  const entry = (overrides: Record<string, unknown> = {}) => ({
    source: 'github-issues', sourceRef: 'owner/repo#1', status: 'pending', attempts: 0, ...overrides,
  });

  it('reports durable pending, claimed, and stranded counts after liveness', async () => {
    const mod = await load();
    const brainStart = requireFn(mod, 'brainStart');
    const brainStatus = requireFn(mod, 'brainStatus');
    const { run } = makeFakeTmuxRunner();
    const out: string[] = [];

    await brainStart({ run, cwd: '/repo', out: () => {} });
    const code = await brainStatus({
      run,
      out: (l: string) => out.push(l),
      readLedgerEntries: async () => [
        entry(), entry({ sourceRef: 'owner/repo#2', status: 'claimed', lastSeenAt: new Date(now - 2_000).toISOString() }),
        entry({ sourceRef: 'owner/repo#3', status: 'claimed', lastSeenAt: new Date(now - 500).toISOString() }),
        entry({ sourceRef: 'owner/repo#4', status: 'done' }),
      ],
      now: () => now,
      staleClaimWindowMs: 1_000,
    });

    expect(code).toBe(0);
    expect(out).toEqual(['brain loop: running', 'pending: 1', 'claimed: 2', 'stranded: 1']);
  });

  it('reads the ledger again on every invocation', async () => {
    const mod = await load();
    const brainStatus = requireFn(mod, 'brainStatus');
    const { run } = makeFakeTmuxRunner();
    const out: string[] = [];
    let entries = [entry()];
    const deps = {
      run, out: (l: string) => out.push(l), readLedgerEntries: async () => entries,
      now: () => now, staleClaimWindowMs: 1_000,
    };

    expect(await brainStatus(deps)).toBe(0);
    entries = [entry({ status: 'claimed', lastSeenAt: new Date(now - 2_000).toISOString() })];
    expect(await brainStatus(deps)).toBe(0);

    expect(out).toEqual([
      'brain loop: stopped', 'pending: 1', 'claimed: 0', 'stranded: 0',
      'brain loop: stopped', 'pending: 0', 'claimed: 1', 'stranded: 1',
    ]);
  });

  it('reports corrupt-ledger quarantine location and no counts', async () => {
    const mod = await load();
    const brainStatus = requireFn(mod, 'brainStatus');
    const { run } = makeFakeTmuxRunner();
    const error = new CorruptLedgerError(
      '/engineer/ledger.json',
      'invalid JSON',
      '/engineer/ledger.json.corrupt-20260911',
    );
    const out: string[] = [];

    const code = await brainStatus({
      run, out: (l: string) => out.push(l), readLedgerEntries: async () => { throw error; },
    });

    expect(code).toBe(1);
    expect(out).toEqual([
      'brain loop: stopped',
      'intake queue: unavailable — intake ledger is corrupt at /engineer/ledger.json; quarantine path: /engineer/ledger.json.corrupt-20260911',
    ]);
    expect(out.join('\n')).not.toMatch(/^(pending|claimed|stranded):/m);
  });

  it('reports a corrupt-ledger quarantine diagnostic and no counts when no path is available', async () => {
    const mod = await load();
    const brainStatus = requireFn(mod, 'brainStatus');
    const { run } = makeFakeTmuxRunner();
    const error = new CorruptLedgerError(
      '/engineer/ledger.json',
      'invalid JSON',
      undefined,
      'copy failed: permission denied',
    );
    const out: string[] = [];

    const code = await brainStatus({
      run, out: (l: string) => out.push(l), readLedgerEntries: async () => { throw error; },
    });

    expect(code).toBe(1);
    expect(out).toEqual([
      'brain loop: stopped',
      'intake queue: unavailable — intake ledger is corrupt at /engineer/ledger.json; quarantine path: copy failed: permission denied',
    ]);
    expect(out.join('\n')).not.toMatch(/^(pending|claimed|stranded):/m);
  });

  it('reports lease unavailability and no counts', async () => {
    const mod = await load();
    const brainStatus = requireFn(mod, 'brainStatus');
    const { run } = makeFakeTmuxRunner();
    const error = new Error('Unable to acquire intake ledger lease: busy');
    const out: string[] = [];

    const code = await brainStatus({
      run, out: (l: string) => out.push(l), readLedgerEntries: async () => { throw error; },
    });

    expect(code).toBe(1);
    expect(out).toEqual(['brain loop: stopped', `intake queue: unavailable — ${error.message}`]);
    expect(out.join('\n')).not.toMatch(/^(pending|claimed|stranded):/m);
  });

  it('labels a recorded notifier batch as the last notification', async () => {
    const mod = await load();
    const brainStatus = requireFn(mod, 'brainStatus');
    const { run } = makeFakeTmuxRunner();
    const out: string[] = [];

    const code = await brainStatus({
      run, out: (l: string) => out.push(l), readLedgerEntries: async () => [], staleClaimWindowMs: 1_000,
      readStatus: async () => JSON.stringify({ count: 3, timestamp: '2026-09-11T12:00:00.000Z' }),
    });

    expect(code).toBe(0);
    expect(out).toEqual([
      'brain loop: stopped', 'pending: 0', 'claimed: 0', 'stranded: 0',
      'last notification: 3 at 2026-09-11T12:00:00.000Z',
    ]);
  });

  it.each([null, '', '{ bad json', JSON.stringify({ timestamp: '2026-09-11T12:00:00.000Z' })])(
    'does not fabricate a notification batch from an absent or invalid status surface',
    async (surface) => {
      const mod = await load();
      const brainStatus = requireFn(mod, 'brainStatus');
      const { run } = makeFakeTmuxRunner();
      const out: string[] = [];

      const code = await brainStatus({
        run, out: (l: string) => out.push(l), readLedgerEntries: async () => [],
        staleClaimWindowMs: 1_000, readStatus: async () => surface,
      });

      expect(code).toBe(0);
      expect(out).toEqual(['brain loop: stopped', 'pending: 0', 'claimed: 0', 'stranded: 0']);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 1: IntakeLoop deps + options types.
//
// Story: FR-1/FR-10 · Plan: .docs/plans/2026-06-30-background-intake-conduct-loop.md (Task 1)
//
// Type-only exports (interfaces) produce no runtime binding, so a static
// `import type { ... }` from a missing module is erased by esbuild before
// resolution and would silently "pass" even when the module does not exist —
// the wrong RED signal. To get a real module-not-found RED, this test uses a
// genuine runtime `import()` of the module (a real resolution, not erased),
// then asserts the module's source text declares both exported types. This
// fails for the right reason (Cannot find module) until intake-loop.ts exists,
// and fails again if either type is renamed/removed.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const INTAKE_LOOP_SRC = join(here, '..', '..', '..', '..', 'src', 'engine', 'engineer', 'intake', 'intake-loop.ts');

describe('intake-loop types', () => {
  it('the module resolves at runtime', async () => {
    // A genuine dynamic import: resolution happens regardless of whether the
    // module has any runtime (value) exports, so this throws
    // ERR_MODULE_NOT_FOUND until intake-loop.ts exists on disk.
    await expect(import('../../../../src/engine/engineer/intake/intake-loop.js')).resolves.toBeTypeOf('object');
  });

  it('exports an IntakeLoopDeps type with poll/enqueue/notify/sleep/now/log', async () => {
    const source = await readFile(INTAKE_LOOP_SRC, 'utf-8');
    expect(source).toMatch(/export\s+(interface|type)\s+IntakeLoopDeps/);
    for (const member of ['poll', 'enqueue', 'notify', 'sleep', 'now', 'log']) {
      expect(source).toMatch(new RegExp(`\\b${member}\\s*[:(]`));
    }
  });

  it('exports an IntakeLoopOptions type with intervalMs, optional once/maxIdlePolls', async () => {
    const source = await readFile(INTAKE_LOOP_SRC, 'utf-8');
    expect(source).toMatch(/export\s+(interface|type)\s+IntakeLoopOptions/);
    expect(source).toMatch(/\bintervalMs\s*:/);
    expect(source).toMatch(/\bonce\?\s*:/);
    expect(source).toMatch(/\bmaxIdlePolls\?\s*:/);
  });

  it('constructs values conforming to each shape (compile-time check)', async () => {
    const mod = (await import(
      '../../../../src/engine/engineer/intake/intake-loop.js'
    )) as Record<string, unknown>;
    type Deps = import('../../../../src/engine/engineer/intake/intake-loop.js').IntakeLoopDeps;
    type Opts = import('../../../../src/engine/engineer/intake/intake-loop.js').IntakeLoopOptions;

    const deps: Deps = {
      poll: async () => [],
      enqueue: async (_envelope: unknown) => {},
      notify: async (_ideas: unknown[]) => {},
      sleep: async (_ms: number) => {},
      now: () => new Date('2026-06-30T00:00:00.000Z'),
      log: (_msg: string) => {},
    };
    const full: Opts = { intervalMs: 5000, once: true, maxIdlePolls: 3 };
    const minimal: Opts = { intervalMs: 5000 };

    expect(typeof deps.poll).toBe('function');
    expect(full.once).toBe(true);
    expect(minimal.intervalMs).toBe(5000);
    expect(mod).toBeTypeOf('object');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2: One tick polls all repos and enqueues captured ideas.
//
// Story: FR-1 happy · Plan: .docs/plans/2026-06-30-background-intake-conduct-loop.md (Task 2)
//
// `intakeTick(deps)` calls the injected `poll()`, enqueues every returned
// envelope via the injected `enqueue()`, and returns a tick summary
// `{ captured: <count> }`. All deps are injected — zero real I/O.
// ─────────────────────────────────────────────────────────────────────────────
describe('intakeTick', () => {
  it('a tick with 2 envelopes from poll() enqueues both and returns {captured: 2}', async () => {
    const mod = (await import(
      '../../../../src/engine/engineer/intake/intake-loop.js'
    )) as Record<string, any>;
    const intakeTick = mod.intakeTick as (deps: any) => Promise<{ captured: number }>;
    expect(typeof intakeTick).toBe('function');

    const envelopeA = {
      id: 'o/a#1',
      source: 'github-issues',
      sourceRef: 'o/a#1',
      text: 'idea for o/a#1',
      status: 'pending' as const,
      receivedAt: '2026-06-30T00:00:00.000Z',
    };
    const envelopeB = {
      id: 'o/b#7',
      source: 'github-issues',
      sourceRef: 'o/b#7',
      text: 'idea for o/b#7',
      status: 'pending' as const,
      receivedAt: '2026-06-30T00:00:00.000Z',
    };

    const poll = async () => [envelopeA, envelopeB];
    const enqueued: unknown[] = [];
    const enqueue = async (envelope: unknown) => {
      enqueued.push(envelope);
    };
    const notify = async (_ideas: unknown[]) => {};
    const sleep = async (_ms: number) => {};
    const now = () => new Date('2026-06-30T00:00:00.000Z');
    const log = (_msg: string) => {};

    const summary = await intakeTick({ poll, enqueue, notify, sleep, now, log });

    expect(summary).toEqual({ captured: 2 });
    expect(enqueued).toHaveLength(2);
    expect(enqueued).toEqual([envelopeA, envelopeB]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 3: Tick re-run captures nothing already ledger-known (exactly-once).
//
// Story: FR-12/FR-2 · Plan: .docs/plans/2026-06-30-background-intake-conduct-loop.md (Task 3)
//
// The adapter's `poll()` is the sole dedup authority (ADR-012): once an idea
// is ledger-known it is omitted from subsequent `poll()` results. This test
// asserts the tick correctly handles that `[]` result — no re-enqueue, no
// re-notify — for exactly-once capture across repeated ticks.
// ─────────────────────────────────────────────────────────────────────────────
describe('intakeTick — ledger dedup (exactly-once)', () => {
  it('a second tick whose poll() returns [] enqueues nothing and notifies nothing', async () => {
    const mod = (await import(
      '../../../../src/engine/engineer/intake/intake-loop.js'
    )) as Record<string, any>;
    const intakeTick = mod.intakeTick as (deps: any) => Promise<{ captured: number }>;

    const envelopeA = {
      id: 'o/a#1',
      source: 'github-issues',
      sourceRef: 'o/a#1',
      text: 'idea for o/a#1',
      status: 'pending' as const,
      receivedAt: '2026-06-30T00:00:00.000Z',
    };

    let callCount = 0;
    const poll = vi.fn(async () => {
      callCount += 1;
      return callCount === 1 ? [envelopeA] : [];
    });
    const enqueue = vi.fn(async (_envelope: unknown) => {});
    const notify = vi.fn(async (_ideas: unknown[]) => {});
    const sleep = async (_ms: number) => {};
    const now = () => new Date('2026-06-30T00:00:00.000Z');
    const log = (_msg: string) => {};

    const deps = { poll, enqueue, notify, sleep, now, log };

    const first = await intakeTick(deps);
    expect(first).toEqual({ captured: 1 });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);

    enqueue.mockClear();
    notify.mockClear();

    const second = await intakeTick(deps);

    expect(second).toEqual({ captured: 0 });
    expect(enqueue).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 5: A failing repo is isolated; loop continues.
//
// Story: FR-7 negative · Plan: .docs/plans/2026-06-30-background-intake-conduct-loop.md (Task 5)
//
// The adapter already isolates per-repo poll failures (FR-27/ADR-012). This
// test asserts the tick defensively survives an unexpected per-envelope
// enqueue failure too: `poll()` yields envelopes for repos A, B, and C, but
// `enqueue()` throws for repo B's envelope. The tick must not throw, must log
// B's error, and must still report `{ captured: 2 }` reflecting A and C.
// ─────────────────────────────────────────────────────────────────────────────
describe('intakeTick — repo isolation on failure', () => {
  it('poll() yields A/B/C but enqueue() throws for B: tick captures A+C, logs B, does not throw', async () => {
    const mod = (await import(
      '../../../../src/engine/engineer/intake/intake-loop.js'
    )) as Record<string, any>;
    const intakeTick = mod.intakeTick as (deps: any) => Promise<{ captured: number }>;

    const envelopeA = {
      id: 'o/a#1',
      source: 'github-issues',
      sourceRef: 'o/a#1',
      text: 'idea for o/a#1',
      status: 'pending' as const,
      receivedAt: '2026-06-30T00:00:00.000Z',
    };
    const envelopeB = {
      id: 'o/b#7',
      source: 'github-issues',
      sourceRef: 'o/b#7',
      text: 'idea for o/b#7',
      status: 'pending' as const,
      receivedAt: '2026-06-30T00:00:00.000Z',
    };
    const envelopeC = {
      id: 'o/c#3',
      source: 'github-issues',
      sourceRef: 'o/c#3',
      text: 'idea for o/c#3',
      status: 'pending' as const,
      receivedAt: '2026-06-30T00:00:00.000Z',
    };

    const poll = vi.fn(async () => [envelopeA, envelopeB, envelopeC]);
    const enqueue = vi.fn(async (envelope: any) => {
      if (envelope === envelopeB) {
        throw new Error('repo o/b unreachable');
      }
    });
    const notify = vi.fn(async (_ideas: unknown[]) => {});
    const sleep = async (_ms: number) => {};
    const now = () => new Date('2026-06-30T00:00:00.000Z');
    const log = vi.fn((_msg: string) => {});

    const deps = { poll, enqueue, notify, sleep, now, log };

    await expect(intakeTick(deps)).resolves.toEqual({ captured: 2 });

    expect(log).toHaveBeenCalled();
    expect(log.mock.calls.some((call: unknown[]) => String(call[0]).includes('o/b unreachable'))).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith([envelopeA, envelopeC]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 7: Captured idea carries target=origin + source-ref (origin routing).
//
// Story: ADR-008 · Plan: .docs/plans/2026-06-30-background-intake-conduct-loop.md (Task 7)
//
// An envelope captured from `owner/X#7` carries `hintRepo: 'owner/X'` (set by
// the GitHub adapter). Before enqueueing, the tick must enrich the envelope
// with an explicit `target` (the origin repo) and `sourceRef` (the full
// source reference) so the `claim` phase can auto-route later without
// recomputing this from the raw source.
// ─────────────────────────────────────────────────────────────────────────────
describe('intakeTick — origin routing (target + sourceRef)', () => {
  it('an envelope from owner/X#7 carries target=owner/X and sourceRef=owner/X#7 when enqueued', async () => {
    const mod = (await import(
      '../../../../src/engine/engineer/intake/intake-loop.js'
    )) as Record<string, any>;
    const intakeTick = mod.intakeTick as (deps: any) => Promise<{ captured: number }>;

    const envelope = {
      id: '7',
      hintRepo: 'owner/X',
      source: 'github-issues',
      text: 'idea for owner/X#7',
      status: 'pending' as const,
      receivedAt: '2026-06-30T00:00:00.000Z',
    };

    const poll = async () => [envelope];
    const enqueue = vi.fn(async (_envelope: unknown) => {});
    const notify = async (_ideas: unknown[]) => {};
    const sleep = async (_ms: number) => {};
    const now = () => new Date('2026-06-30T00:00:00.000Z');
    const log = (_msg: string) => {};

    await intakeTick({ poll, enqueue, notify, sleep, now, log });

    expect(enqueue).toHaveBeenCalledTimes(1);
    const enqueued = enqueue.mock.calls[0][0];
    expect(enqueued).toMatchObject({ target: 'owner/X', sourceRef: 'owner/X#7' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 8: Origin-unresolved idea is still enqueued (not dropped, not
// arbitrary).
//
// Story: FR-7/ADR-008 negative · Plan: .docs/plans/2026-06-30-background-intake-conduct-loop.md (Task 8)
//
// When an envelope carries no `hintRepo` (origin cannot be resolved), the
// tick must NOT drop it — it still gets enqueued, preserving its raw
// `sourceRef` unchanged, and a warning is logged for observability so the
// idea can be routed manually later.
// ─────────────────────────────────────────────────────────────────────────────
describe('intakeTick — origin-unresolved (preserve, do not drop)', () => {
  it('an envelope without hintRepo is still enqueued with its raw sourceRef, and a warning is logged', async () => {
    const mod = (await import(
      '../../../../src/engine/engineer/intake/intake-loop.js'
    )) as Record<string, any>;
    const intakeTick = mod.intakeTick as (deps: any) => Promise<{ captured: number }>;

    const envelope = {
      id: 'unknown#42',
      source: 'github-issues',
      sourceRef: 'unknown#42',
      text: 'idea with no resolvable origin',
      status: 'pending' as const,
      receivedAt: '2026-06-30T00:00:00.000Z',
    };

    const poll = async () => [envelope];
    const enqueue = vi.fn(async (_envelope: unknown) => {});
    const notify = async (_ideas: unknown[]) => {};
    const sleep = async (_ms: number) => {};
    const now = () => new Date('2026-06-30T00:00:00.000Z');
    const log = vi.fn((_msg: string) => {});

    const summary = await intakeTick({ poll, enqueue, notify, sleep, now, log });

    expect(summary).toEqual({ captured: 1 });
    expect(enqueue).toHaveBeenCalledTimes(1);
    const enqueued = enqueue.mock.calls[0][0];
    expect(enqueued).toMatchObject({ sourceRef: 'unknown#42' });
    expect(enqueued.target).toBeUndefined();
    expect(log).toHaveBeenCalled();
    expect(
      log.mock.calls.some(
        (call: unknown[]) => /origin-unresolved/i.test(String(call[0])) && String(call[0]).includes('unknown#42'),
      ),
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 4: Interval loop — N ticks over N intervals, honors `once` and
// `intervalMs`.
//
// Story: FR-1/FR-10 · Plan: .docs/plans/2026-06-30-background-intake-conduct-loop.md (Task 4)
//
// `runIntakeLoop(deps, opts)` is a poll-sleep loop over the already-tested
// `intakeTick(deps)`. With `opts.once = true` it runs exactly one tick and
// returns without sleeping. Otherwise it loops continuously, calling the
// injected `deps.sleep(opts.intervalMs)` between ticks — these tests use a
// fake sleep/clock (no real delays) and stop the continuous-mode loop by
// having the fake sleep throw after N calls.
// ─────────────────────────────────────────────────────────────────────────────
describe('runIntakeLoop', () => {
  it('with once=true runs exactly one tick and returns (no sleep)', async () => {
    const mod = (await import(
      '../../../../src/engine/engineer/intake/intake-loop.js'
    )) as Record<string, any>;
    const runIntakeLoop = mod.runIntakeLoop as (deps: any, opts: any) => Promise<void>;
    expect(typeof runIntakeLoop).toBe('function');

    let pollCalls = 0;
    const poll = vi.fn(async () => {
      pollCalls += 1;
      return [];
    });
    const enqueue = vi.fn(async (_envelope: unknown) => {});
    const notify = vi.fn(async (_ideas: unknown[]) => {});
    const sleep = vi.fn(async (_ms: number) => {});
    const now = () => new Date('2026-06-30T00:00:00.000Z');
    const log = (_msg: string) => {};

    await runIntakeLoop({ poll, enqueue, notify, sleep, now, log }, { intervalMs: 60000, once: true });

    expect(pollCalls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('with once=false (continuous) runs 3 ticks over 3 intervals, sleeping between ticks', async () => {
    const mod = (await import(
      '../../../../src/engine/engineer/intake/intake-loop.js'
    )) as Record<string, any>;
    const runIntakeLoop = mod.runIntakeLoop as (deps: any, opts: any) => Promise<void>;

    let tickCount = 0;
    const poll = vi.fn(async () => {
      tickCount += 1;
      return [];
    });
    const enqueue = vi.fn(async (_envelope: unknown) => {});
    const notify = vi.fn(async (_ideas: unknown[]) => {});
    const now = () => new Date('2026-06-30T00:00:00.000Z');
    const log = (_msg: string) => {};

    const delays: number[] = [];
    let sleepCalls = 0;
    const STOP = { __stop: true };
    const sleep = vi.fn(async (ms: number) => {
      delays.push(ms);
      sleepCalls += 1;
      if (sleepCalls >= 3) {
        throw STOP;
      }
    });

    await runIntakeLoop(
      { poll, enqueue, notify, sleep, now, log },
      { intervalMs: 60000, once: false },
    ).catch((e: unknown) => {
      if (e !== STOP) throw e;
    });

    // Each iteration ticks then sleeps; the 3rd sleep call throws, stopping
    // the loop before a 4th tick begins — so exactly 3 ticks and 3 sleeps.
    expect(tickCount).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([60000, 60000, 60000]);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Task 6: Whole-tick failure does not crash the loop.
  //
  // Story: FR-27 negative · Plan: .docs/plans/2026-06-30-background-intake-conduct-loop.md (Task 6)
  //
  // `intakeTick()` already isolates per-repo poll/enqueue failures (Task 5),
  // but an unexpected failure elsewhere in the tick (e.g. notify()) is not
  // wrapped and would otherwise propagate out of intakeTick(). This test
  // forces that path via a throwing `notify()` on the first tick and asserts
  // `runIntakeLoop` catches it, logs it, and proceeds to a second tick.
  // ───────────────────────────────────────────────────────────────────────
  it('a tick that throws (e.g. notify() rejects) is caught, logged, and the loop continues to the next tick', async () => {
    const mod = (await import(
      '../../../../src/engine/engineer/intake/intake-loop.js'
    )) as Record<string, any>;
    const runIntakeLoop = mod.runIntakeLoop as (deps: any, opts: any) => Promise<void>;

    const envelope = {
      id: 'o/a#1',
      source: 'github-issues',
      sourceRef: 'o/a#1',
      text: 'idea for o/a#1',
      status: 'pending' as const,
      receivedAt: '2026-06-30T00:00:00.000Z',
    };

    let pollCalls = 0;
    const poll = vi.fn(async () => {
      pollCalls += 1;
      // Only the first tick captures an envelope, so only the first tick's
      // notify() call is exercised (and throws).
      return pollCalls === 1 ? [envelope] : [];
    });
    const enqueue = vi.fn(async (_envelope: unknown) => {});
    const notify = vi.fn(async (_ideas: unknown[]) => {
      if (pollCalls === 1) {
        throw new Error('notify: total tick failure');
      }
    });
    const now = () => new Date('2026-06-30T00:00:00.000Z');
    const log = vi.fn((_msg: string) => {});

    const STOP = { __stop: true };
    let sleepCalls = 0;
    const sleep = vi.fn(async (_ms: number) => {
      sleepCalls += 1;
      if (sleepCalls >= 2) {
        throw STOP;
      }
    });

    await expect(
      runIntakeLoop(
        { poll, enqueue, notify, sleep, now, log },
        { intervalMs: 1000, once: false },
      ).catch((e: unknown) => {
        if (e !== STOP) throw e;
      }),
    ).resolves.toBeUndefined();

    // The first tick's notify() threw, but the loop caught it, logged it, and
    // proceeded through sleep to a second tick — no exception escaped
    // runIntakeLoop other than the deliberate STOP sentinel from sleep().
    expect(pollCalls).toBe(2);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.some((call: unknown[]) => String(call[0]).includes('notify: total tick failure'))).toBe(
      true,
    );
  });
});

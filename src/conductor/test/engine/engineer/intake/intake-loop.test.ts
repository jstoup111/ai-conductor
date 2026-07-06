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

import { describe, it, expect } from 'vitest';
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

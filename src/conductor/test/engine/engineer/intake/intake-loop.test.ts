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

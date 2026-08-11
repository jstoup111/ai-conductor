// Tests for the DECIDE-time `Wired-into:` anchor validator and its
// `conduct-ts validate-wired-into <plan>` subcommand.
//
// Incident this closes: a plan whose `Wired-into:` anchors never resolved
// against the real wiring machinery built for hours with 0/19 tasks ever
// marked completed — per-task completion verification kept failing silently.
// The validator runs the SAME check BUILD-time verification runs
// (`verifyDeclaredSites`), at authoring time, so a bad anchor fails in
// seconds instead of hours.
//
// Level: unit for the engine module (injected FileReader — no fs), and
// integration for the CLI dispatch (real fs against an mkdtemp scratch dir,
// which is the boundary under test there).

import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  validateWiredIntoPlan,
  renderWiredIntoValidationReport,
} from '../../src/engine/validate-wired-into.js';

/** Injected FileReader over an in-memory tree; missing paths throw, exactly as fs does. */
function readerFor(files: Record<string, string>) {
  return async (path: string): Promise<string> => {
    const content = files[path];
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  };
}

function plan(body: string): string {
  return `# Implementation Plan: Fixture\n\n## Tasks\n\n${body}\n`;
}

// ─── 1. Engine module: per-task verdicts ─────────────────────────────────────

describe('validateWiredIntoPlan — declared call-site anchors', () => {
  it('PASSes a simple anchor whose file references the symbol', async () => {
    const result = await validateWiredIntoPlan(
      plan('### Task 1: Add helper\n**Wired-into:** `src/engine/loop.ts#dispatchStep`\n'),
      readerFor({ 'src/engine/loop.ts': 'export function run() {\n  dispatchStep(next);\n}\n' }),
    );

    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].taskId).toBe('1');
    expect(result.rows[0].status).toBe('pass');
    expect(result.rows[0].form).toBe('declared');
    expect(result.rows[0].detail).toContain('src/engine/loop.ts#dispatchStep');
  });

  it('PASSes a qualified `Class.method` anchor when the file references it', async () => {
    const result = await validateWiredIntoPlan(
      plan('### Task 2: Wire step\n**Wired-into:** `src/engine/conductor.ts#Conductor.run`\n'),
      readerFor({
        'src/engine/conductor.ts':
          '// Conductor.run drives the step loop.\nexport class Conductor {}\n',
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.rows[0].status).toBe('pass');
  });

  it('FAILs an anchor whose declared file does not exist', async () => {
    const result = await validateWiredIntoPlan(
      plan('### Task 3: Ghost\n**Wired-into:** `src/engine/missing.ts#dispatchStep`\n'),
      readerFor({}),
    );

    expect(result.ok).toBe(false);
    expect(result.rows[0].status).toBe('fail');
    expect(result.rows[0].detail).toContain('file not found');
  });

  it('FAILs an anchor whose symbol never appears in the declared file', async () => {
    const result = await validateWiredIntoPlan(
      plan('### Task 4: Absent\n**Wired-into:** `src/engine/loop.ts#totallyAbsentSymbol`\n'),
      readerFor({ 'src/engine/loop.ts': 'export function run() {}\n' }),
    );

    expect(result.ok).toBe(false);
    expect(result.rows[0].status).toBe('fail');
    expect(result.rows[0].detail).toContain('totallyAbsentSymbol');
  });

  it('FAILs a malformed anchor (path escaping the repo root)', async () => {
    const result = await validateWiredIntoPlan(
      plan('### Task 5: Outside\n**Wired-into:** `../outside.ts#foo`\n'),
      readerFor({}),
    );

    expect(result.ok).toBe(false);
    expect(result.rows[0].status).toBe('fail');
    expect(result.rows[0].form).toBe('malformed');
  });

  it('FAILs a `Wired-into:` line that declares no call site at all', async () => {
    const result = await validateWiredIntoPlan(
      plan('### Task 6: Empty\n**Wired-into:**\n'),
      readerFor({}),
    );

    expect(result.ok).toBe(false);
    expect(result.rows[0].status).toBe('fail');
    expect(result.rows[0].detail).toContain('no declared call site');
  });
});

describe('validateWiredIntoPlan — inheritance and waiver forms', () => {
  it('resolves `same as Task N` and validates the inherited site', async () => {
    const result = await validateWiredIntoPlan(
      plan(
        '### Task 1: Add helper\n**Wired-into:** `src/engine/loop.ts#dispatchStep`\n\n' +
          '### Task 2: Extend helper\n**Wired-into:** same as Task 1\n',
      ),
      readerFor({ 'src/engine/loop.ts': 'dispatchStep(next);\n' }),
    );

    expect(result.ok).toBe(true);
    expect(result.rows.map((r) => r.taskId)).toEqual(['1', '2']);
    expect(result.rows[1].status).toBe('pass');
    expect(result.rows[1].detail).toContain('src/engine/loop.ts#dispatchStep');
  });

  it('propagates an inherited anchor FAILURE to the inheriting task', async () => {
    const result = await validateWiredIntoPlan(
      plan(
        '### Task 1: Add helper\n**Wired-into:** `src/engine/missing.ts#dispatchStep`\n\n' +
          '### Task 2: Extend helper\n**Wired-into:** same as Task 1\n',
      ),
      readerFor({}),
    );

    expect(result.ok).toBe(false);
    expect(result.rows.every((r) => r.status === 'fail')).toBe(true);
  });

  it('FAILs `same as Task N` when the inheritance target does not exist', async () => {
    const result = await validateWiredIntoPlan(
      plan('### Task 2: Orphan inheritor\n**Wired-into:** same as Task 99\n'),
      readerFor({}),
    );

    expect(result.ok).toBe(false);
    expect(result.rows[0].status).toBe('fail');
    expect(result.rows[0].detail).toContain('Task 99');
  });

  it('SKIPs the `none (...)` waiver forms without touching the filesystem', async () => {
    const result = await validateWiredIntoPlan(
      plan(
        '### Task 1: Refactor\n**Wired-into:** none (no new production surface)\n\n' +
          '### Task 2: Deferred\n**Wired-into:** none (inert until #431)\n',
      ),
      async () => {
        throw new Error('no file should be read for a none (...) form');
      },
    );

    expect(result.ok).toBe(true);
    expect(result.rows.map((r) => r.status)).toEqual(['skip', 'skip']);
    expect(result.rows.map((r) => r.form)).toEqual(['no_new_surface', 'inert']);
  });

  // The DECIDE-time counterpart of the BUILD-time task-ref resolution. A task
  // ref is the one inert form whose target is fully known at authoring time, so
  // it is resolved here rather than deferred — an unresolvable one must fail
  // while the plan is still editable, not after DECIDE seals it.
  it('SKIPs an inert task ref that names a real task in the same plan', async () => {
    const result = await validateWiredIntoPlan(
      plan(
        '### Task 2: Build helper\n**Wired-into:** none (inert until Task 6)\n\n' +
          '### Task 6: Wire it\n**Wired-into:** none (no new production surface)\n',
      ),
      async () => {
        throw new Error('no file should be read for a none (...) form');
      },
    );

    expect(result.ok).toBe(true);
    expect(result.rows.map((r) => r.status)).toEqual(['skip', 'skip']);
    expect(result.rows[0].detail).toContain('Task 6');
  });

  it('FAILs an inert task ref naming a task that does not exist in the plan', async () => {
    const result = await validateWiredIntoPlan(
      plan(
        '### Task 2: Build helper\n**Wired-into:** none (inert until Task 99)\n\n' +
          '### Task 6: Wire it\n**Wired-into:** none (no new production surface)\n',
      ),
      async () => {
        throw new Error('no file should be read for a none (...) form');
      },
    );

    expect(result.ok).toBe(false);
    expect(result.rows[0].status).toBe('fail');
    expect(result.rows[0].detail).toContain('Task 99');
  });

  it('reports no rows (and stays ok) for a plan with no `Wired-into:` lines', async () => {
    const result = await validateWiredIntoPlan(
      plan('### Task 1: Nothing declared\n**Files:** src/a.ts\n'),
      readerFor({}),
    );

    expect(result.rows).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

// ─── 2. Report rendering ─────────────────────────────────────────────────────

describe('renderWiredIntoValidationReport', () => {
  it('renders a per-task PASS/FAIL/SKIP report naming the plan and the failure count', async () => {
    const result = await validateWiredIntoPlan(
      plan(
        '### Task 1: Good\n**Wired-into:** `src/engine/loop.ts#dispatchStep`\n\n' +
          '### Task 2: Bad\n**Wired-into:** `src/engine/missing.ts#nope`\n\n' +
          '### Task 3: Waived\n**Wired-into:** none (no new production surface)\n',
      ),
      readerFor({ 'src/engine/loop.ts': 'dispatchStep(next);\n' }),
    );

    const report = renderWiredIntoValidationReport(result, '.docs/plans/fixture.md');

    expect(report).toContain('.docs/plans/fixture.md');
    expect(report).toContain('PASS');
    expect(report).toContain('FAIL');
    expect(report).toContain('SKIP');
    expect(report).toContain('Task 2');
    expect(report).toMatch(/1 FAIL/);
  });
});

// ─── 3. CLI surface registration ─────────────────────────────────────────────

describe('CLI surface — conduct-ts validate-wired-into subcommand', () => {
  it('createProgram() exposes a `validate-wired-into` subcommand with --cwd', async () => {
    const { createProgram } = await import('../../src/index.js');
    const cmd = createProgram().commands.find((c) => c.name() === 'validate-wired-into');
    expect(cmd).toBeDefined();
    expect((cmd?.options ?? []).map((o) => o.long)).toContain('--cwd');
  });
});

// ─── 4. argv detection ───────────────────────────────────────────────────────

describe('detectValidateWiredIntoCommand — argv detection', () => {
  it('parses the plan positional and --cwd', async () => {
    const { detectValidateWiredIntoCommand } = await import('../../src/index.js');
    const result = detectValidateWiredIntoCommand([
      'node',
      'conduct-ts',
      'validate-wired-into',
      '.docs/plans/p.md',
      '--cwd',
      '/tmp/some-repo',
    ]);

    expect(result).not.toBeNull();
    expect(result?.plan).toBe('.docs/plans/p.md');
    expect(result?.cwd).toBe('/tmp/some-repo');
  });

  it('returns null for other argv', async () => {
    const { detectValidateWiredIntoCommand } = await import('../../src/index.js');
    expect(detectValidateWiredIntoCommand(['node', 'conduct-ts', 'overlap-scan'])).toBeNull();
    expect(detectValidateWiredIntoCommand(['node', 'conduct-ts'])).toBeNull();
  });
});

// ─── 5. CLI dispatch against a real scratch tree ─────────────────────────────

describe('validateWiredIntoCommand — real dispatch', () => {
  async function scratch(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'validate-wired-into-'));
  }

  it('exits 0 and reports PASS when every declared anchor resolves', async () => {
    const { validateWiredIntoCommand, detectValidateWiredIntoCommand } = await import(
      '../../src/index.js'
    );
    const dir = await scratch();
    try {
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(join(dir, 'src', 'loop.ts'), 'dispatchStep(next);\n');
      await writeFile(
        join(dir, 'plan.md'),
        plan('### Task 1: Good\n**Wired-into:** `src/loop.ts#dispatchStep`\n'),
      );

      const cmd = detectValidateWiredIntoCommand([
        'node',
        'conduct-ts',
        'validate-wired-into',
        'plan.md',
        '--cwd',
        dir,
      ]);
      const printed: string[] = [];
      const code = await validateWiredIntoCommand(cmd!, { print: (s) => printed.push(s) });

      expect(code).toBe(0);
      expect(printed.join('\n')).toContain('PASS');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('exits 1 and reports FAIL when an anchor does not resolve', async () => {
    const { validateWiredIntoCommand, detectValidateWiredIntoCommand } = await import(
      '../../src/index.js'
    );
    const dir = await scratch();
    try {
      await writeFile(
        join(dir, 'plan.md'),
        plan('### Task 1: Bad\n**Wired-into:** `src/missing.ts#dispatchStep`\n'),
      );

      const cmd = detectValidateWiredIntoCommand([
        'node',
        'conduct-ts',
        'validate-wired-into',
        'plan.md',
        '--cwd',
        dir,
      ]);
      const printed: string[] = [];
      const code = await validateWiredIntoCommand(cmd!, { print: (s) => printed.push(s) });

      expect(code).toBe(1);
      expect(printed.join('\n')).toContain('FAIL');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('exits 1 with a clear message when the plan file itself is unreadable', async () => {
    const { validateWiredIntoCommand, detectValidateWiredIntoCommand } = await import(
      '../../src/index.js'
    );
    const dir = await scratch();
    try {
      const cmd = detectValidateWiredIntoCommand([
        'node',
        'conduct-ts',
        'validate-wired-into',
        'nope.md',
        '--cwd',
        dir,
      ]);
      const printed: string[] = [];
      const code = await validateWiredIntoCommand(cmd!, { print: (s) => printed.push(s) });

      expect(code).toBe(1);
      expect(printed.join('\n')).toContain('nope.md');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('exits 1 when no plan path is given', async () => {
    const { validateWiredIntoCommand, detectValidateWiredIntoCommand } = await import(
      '../../src/index.js'
    );
    const cmd = detectValidateWiredIntoCommand(['node', 'conduct-ts', 'validate-wired-into']);
    const printed: string[] = [];
    const code = await validateWiredIntoCommand(cmd!, { print: (s) => printed.push(s) });

    expect(code).toBe(1);
    expect(printed.join('\n')).toMatch(/usage/i);
  });
});

/**
 * Acceptance specs for "WiringEvidence artifact — validated, named,
 * kickback-consumable" — .docs/stories/2026-07-12-wiring-reachability-gate.md
 * (Story: "WiringEvidence artifact — validated, named, kickback-consumable",
 * ~lines 308-338) + .docs/plans/2026-07-12-wiring-reachability-gate.md (27
 * TDD tasks, NOT YET IMPLEMENTED as of this file's authoring).
 *
 * WHY ACCEPTANCE-LEVEL (not unit): this story crosses the seam between an
 * on-disk artifact (`.pipeline/wiring-evidence.json`, written by the Layer
 * 1/2 probe elsewhere) and the REAL `checkStepCompletion` dispatcher in
 * `src/engine/artifacts.ts`, which is the SAME production entry point every
 * other gate (build, build_review, manual_test, prd_audit, ...) goes through.
 * A test that hand-called a not-yet-written `validateWiringEvidence`
 * function directly would only prove that function's logic, not that
 * `checkStepCompletion('wiring_check', ...)` actually reaches it — the two
 * currently disagree in a way only observable through the dispatcher itself
 * (see PRE-FIX RED below). This mirrors this repo's own precedent for
 * "prove the composition, not just the unit" acceptance specs (see
 * `judged-attribution-verdict-persistence.acceptance.test.ts`'s header).
 *
 * PRE-FIX RED: as of this file's authoring, `'wiring_check'` is not a
 * registered `StepName` in `STEP_ARTIFACT_GLOBS` or `CUSTOM_COMPLETION_PREDICATES`
 * (grep confirms no `wiring_check` key in either map). `checkStepCompletion`'s
 * fallback path is:
 *
 *   const patterns = [...(STEP_ARTIFACT_GLOBS[step] ?? []), ...extra];
 *   if (patterns.length === 0) return { done: true };
 *
 * `STEP_ARTIFACT_GLOBS['wiring_check']` is `undefined` and there's no config
 * extra glob, so `patterns` is `[]` and the gate reports `done: true`
 * UNCONDITIONALLY — with a gap-laden evidence file, a stale-HEAD evidence
 * file, or NO evidence file on disk at all. Every negative-path test below
 * pins the FUTURE (gap-aware, freshness-checked, gap-message-carrying)
 * behavior and is expected to FAIL against today's always-true fallback.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { checkStepCompletion } from '../../src/engine/artifacts.js';
import { computeWiringEvidence } from '../../src/engine/wiring-probe.js';
import type { GitRunner } from '../../src/engine/pr-labels.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { StepName } from '../../src/types/index.js';

const execFileP = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileP(
    'git',
    ['-c', 'user.email=t@test', '-c', 'user.name=t', ...args],
    { cwd },
  );
  return stdout;
}

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wiring-evidence-'));
  await git(dir, 'init', '-q', '-b', 'main');
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  await writeFile(join(dir, 'README.md'), '# fixture\n');
  await git(dir, 'add', '.');
  await git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

async function headSha(dir: string): Promise<string> {
  return (await git(dir, 'rev-parse', 'HEAD')).trim();
}

const WIRING_CHECK = 'wiring_check' as unknown as StepName;

const localGitRunner: GitRunner = async (args, opts) => ({
  stdout: await git(opts.cwd, ...args),
});

const noGitHub = async (): Promise<{ stdout: string }> => {
  throw new Error('GitHub must not be called by same-file composition acceptance fixtures');
};

type CompositionVariant = 'qualifying' | 'dead-helper' | 'shadowed-helper';

interface CompositionFixture {
  dir: string;
  base: string;
  head: string;
  planPath: string;
}

async function initCompositionFixture(options: {
  variant?: CompositionVariant;
  incidentalTestImport?: boolean;
  testOnlyRootChain?: boolean;
} = {}): Promise<CompositionFixture> {
  const dir = await mkdtemp(join(tmpdir(), 'same-file-wiring-'));
  const variant = options.variant ?? 'qualifying';

  await git(dir, 'init', '-q', '-b', 'main');
  await mkdir(join(dir, 'src'), { recursive: true });
  await mkdir(join(dir, 'test'), { recursive: true });
  await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
  await writeFile(join(dir, 'package.json'), '{"type":"module"}\n');
  await writeFile(join(dir, 'tsconfig.json'), '{"compilerOptions":{"module":"esnext"}}\n');
  await writeFile(
    join(dir, 'src', 'root.ts'),
    options.testOnlyRootChain
      ? "import '../test/bridge.test.js';\n"
      : "import { productionCaller } from './composed.js';\nvoid productionCaller();\n",
  );
  await writeFile(
    join(dir, 'src', 'composed.ts'),
    'export function productionCaller(): number { return 1; }\n',
  );
  if (options.testOnlyRootChain) {
    await writeFile(
      join(dir, 'test', 'bridge.test.ts'),
      "import { productionCaller } from '../src/composed.js';\nvoid productionCaller();\n",
    );
  }

  const planPath = join(
    dir,
    '.docs',
    'plans',
    'wiring-gate-flags-production-reachable-seams-compo.md',
  );
  await writeFile(
    planPath,
    [
      '### Task 1: Compose helper in its production module',
      '**Files:** `src/composed.ts`',
      '**Wired-into:** `src/composed.ts#productionCaller`',
      '',
    ].join('\n'),
  );
  await git(dir, 'add', '.');
  await git(dir, 'commit', '-q', '-m', 'base fixture');
  const base = await headSha(dir);

  const callerBody =
    variant === 'dead-helper'
      ? 'return 1;'
      : variant === 'shadowed-helper'
        ? 'const composedHelper = (): number => 9; return composedHelper();'
        : 'return composedHelper();';
  await writeFile(
    join(dir, 'src', 'composed.ts'),
    [
      'export function composedHelper(): number { return 7; }',
      `export function productionCaller(): number { ${callerBody} }`,
      '',
    ].join('\n'),
  );
  if (options.incidentalTestImport) {
    await writeFile(
      join(dir, 'test', 'composed.test.ts'),
      "import { composedHelper } from '../src/composed.js';\nvoid composedHelper();\n",
    );
  }
  await git(dir, 'add', '.');
  await git(dir, 'commit', '-q', '-m', `feature fixture: ${variant}`);

  return { dir, base, head: await headSha(dir), planPath };
}

async function runCompositionBoundary(
  fixture: CompositionFixture,
  config: HarnessConfig,
) {
  return checkStepCompletion(fixture.dir, WIRING_CHECK, {
    getHeadSha: async () => fixture.head,
    wiringProbe: () =>
      computeWiringEvidence({
        runGit: localGitRunner,
        projectRoot: fixture.dir,
        planPath: fixture.planPath,
        config,
        gh: noGitHub,
        anchor: fixture.base,
      }),
  });
}

describe('acceptance: WiringEvidence artifact drives checkStepCompletion(wiring_check) end-to-end', () => {
  let dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    dirs = [];
  });

  it('a valid zero-gap evidence file reports done:true from a registered predicate that actually read it', async () => {
    const dir = await initRepo();
    dirs.push(dir);
    const head = await headSha(dir);

    await writeFile(
      join(dir, '.pipeline/wiring-evidence.json'),
      JSON.stringify({
        schema: 1,
        base: '0'.repeat(40),
        head,
        tasks: [{ id: 't1', contract: 'none (no new production surface)', gaps: [] }],
        layer2: { applicable: false, reason: 'Layer 2 not applicable (no TS project detected)' },
        waivers: [],
      }),
    );

    const result = await checkStepCompletion(dir, WIRING_CHECK);

    expect(result.done).toBe(true);
  });

  it('an evidence file WITH GAPS reports done:false naming the gap — not the today-always-true fallback', async () => {
    const dir = await initRepo();
    dirs.push(dir);
    const head = await headSha(dir);

    await writeFile(
      join(dir, '.pipeline/wiring-evidence.json'),
      JSON.stringify({
        schema: 1,
        base: '0'.repeat(40),
        head,
        tasks: [
          {
            id: 't1',
            contract: 'src/engine/foo.ts#bar',
            gaps: [
              {
                kind: 'orphan-export',
                message:
                  '«bar» exported but referenced by no production code (0 test-only references excluded)',
              },
            ],
          },
        ],
        layer2: { applicable: false, reason: 'Layer 2 not applicable (no TS project detected)' },
        waivers: [],
      }),
    );

    const result = await checkStepCompletion(dir, WIRING_CHECK);

    // Today this is `done: true` (patterns.length === 0 fallback) — this
    // assertion is the RED signal.
    expect(result.done).toBe(false);
    expect(result.reason ?? '').toContain('bar');
  });

  it('reports done:false when NO evidence file exists at all — never the bare-fallback done:true', async () => {
    const dir = await initRepo();
    dirs.push(dir);
    // No .pipeline/wiring-evidence.json written.

    const result = await checkStepCompletion(dir, WIRING_CHECK);

    // Today: patterns.length === 0 -> done:true even with zero evidence.
    expect(result.done).toBe(false);
  });

  it('freshness: evidence recorded for a stale HEAD sha (HEAD has since advanced) is unsatisfied', async () => {
    const dir = await initRepo();
    dirs.push(dir);
    const staleHead = await headSha(dir);

    await writeFile(
      join(dir, '.pipeline/wiring-evidence.json'),
      JSON.stringify({
        schema: 1,
        base: '0'.repeat(40),
        head: staleHead,
        tasks: [{ id: 't1', contract: 'none (no new production surface)', gaps: [] }],
        layer2: { applicable: false, reason: 'Layer 2 not applicable (no TS project detected)' },
        waivers: [],
      }),
    );

    // Advance HEAD by one commit after writing evidence.
    await writeFile(join(dir, 'src.txt'), 'more work\n');
    await git(dir, 'add', '.');
    await git(dir, 'commit', '-q', '-m', 'advance HEAD past evidence');

    const result = await checkStepCompletion(dir, WIRING_CHECK, {
      getHeadSha: async () => headSha(dir),
    });

    // Today: no freshness check exists at all (fallback is unconditional
    // done:true) — this fails against that always-true behavior.
    expect(result.done).toBe(false);
  });

  it('gap kickback carries every gap\'s full named message, not a truncated or generic summary', async () => {
    const dir = await initRepo();
    dirs.push(dir);
    const head = await headSha(dir);

    const gapMessages = [
      'declared call site src/x.ts#foo has no non-test reference to «foo» (searched: src/x.ts)',
      '«bar» exported but referenced by no production code (0 test-only references excluded)',
    ];

    await writeFile(
      join(dir, '.pipeline/wiring-evidence.json'),
      JSON.stringify({
        schema: 1,
        base: '0'.repeat(40),
        head,
        tasks: [
          { id: 't1', contract: 'src/x.ts#foo', gaps: [{ kind: 'unreferenced-site', message: gapMessages[0] }] },
          { id: 't2', contract: 'src/y.ts#bar', gaps: [{ kind: 'orphan-export', message: gapMessages[1] }] },
        ],
        layer2: { applicable: false, reason: 'Layer 2 not applicable (no TS project detected)' },
        waivers: [],
      }),
    );

    const result = await checkStepCompletion(dir, WIRING_CHECK);

    // Today: no predicate exists for this step name, so there is no
    // `kickback`-shaped reason at all to assert on — `result.reason` is
    // undefined (done:true fallback carries no reason).
    expect(result.done).toBe(false);
    for (const msg of gapMessages) {
      expect(result.reason ?? '').toContain(msg);
    }
  });
});

/**
 * Acceptance coverage for
 * `.docs/stories/wiring-gate-flags-production-reachable-seams-compo.md`.
 *
 * Production call sites exercised:
 * - artifacts.ts: CUSTOM_COMPLETION_PREDICATES.wiring_check
 * - artifacts.ts: deriveAndPersistWiringEvidence
 * - wiring-probe.ts: computeWiringEvidence
 *
 * These specs drive the real compute -> persist -> validate completion seam.
 * Local Git is real because diff/base semantics are part of the story; GitHub
 * remains a rejecting fake and no network or provider process is reachable.
 */
describe('acceptance: production-reachable same-file composition satisfies wiring_check', () => {
  let dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    dirs = [];
  });

  it('persists a typed proof and passes when caller identity and the production root chain agree', async () => {
    const fixture = await initCompositionFixture();
    dirs.push(fixture.dir);

    const result = await runCompositionBoundary(fixture, {
      wiring: { entry_points: ['src/root.ts'] },
    });

    expect(result.done, result.reason).toBe(true);
    const evidence = JSON.parse(
      await readFile(join(fixture.dir, '.pipeline', 'wiring-evidence.json'), 'utf8'),
    ) as { tasks: Array<Record<string, unknown>> };
    const task = evidence.tasks.find((candidate) => candidate.id === '1');
    const proofs = Array.isArray(task?.proofs) ? task.proofs : [];
    const proof = proofs.find(
      (candidate) =>
        typeof candidate === 'object' &&
        candidate !== null &&
        (candidate as Record<string, unknown>).kind === 'same-file-composition',
    );
    const serializedProof = JSON.stringify(proof);

    expect(proof).toBeDefined();
    expect(serializedProof).toContain('composedHelper');
    expect(serializedProof).toContain('productionCaller');
    expect(serializedProof).toContain('src/composed.ts');
    expect(serializedProof).toContain('src/root.ts');
  });

  it('allows an incidental test import when the same three production proofs still hold', async () => {
    const fixture = await initCompositionFixture({ incidentalTestImport: true });
    dirs.push(fixture.dir);

    const result = await runCompositionBoundary(fixture, {
      wiring: { entry_points: ['src/root.ts'] },
    });

    expect(result.done, result.reason).toBe(true);
  });

  it.each([
    ['reachable dead helper', 'dead-helper' as const],
    ['shadowed same-name binding', 'shadowed-helper' as const],
  ])('keeps a named orphan gap for a %s', async (_label, variant) => {
    const fixture = await initCompositionFixture({ variant });
    dirs.push(fixture.dir);

    const result = await runCompositionBoundary(fixture, {
      wiring: { entry_points: ['src/root.ts'] },
    });

    expect(result.done).toBe(false);
    expect(result.reason ?? '').toContain('composedHelper');
  });

  it('denies the exception when the module is reachable only through a test import edge', async () => {
    const fixture = await initCompositionFixture({ testOnlyRootChain: true });
    dirs.push(fixture.dir);

    const result = await runCompositionBoundary(fixture, {
      wiring: { entry_points: ['src/root.ts'] },
    });

    expect(result.done).toBe(false);
    expect(result.reason ?? '').toContain('composedHelper');
  });

  it('denies the exception when a TS project has no configured production entry point', async () => {
    const fixture = await initCompositionFixture();
    dirs.push(fixture.dir);

    const result = await runCompositionBoundary(fixture, {});

    expect(result.done).toBe(false);
    expect(result.reason ?? '').toContain('composedHelper');
  });

  it('fails closed when persisted evidence claims an unknown proof kind', async () => {
    const fixture = await initCompositionFixture();
    dirs.push(fixture.dir);
    await mkdir(join(fixture.dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(fixture.dir, '.pipeline', 'wiring-evidence.json'),
      JSON.stringify({
        schema: 1,
        base: fixture.base,
        head: fixture.head,
        tasks: [
          {
            id: '1',
            contract: 'src/composed.ts#productionCaller',
            gaps: [],
            proofs: [{ kind: 'future-proof' }],
          },
        ],
        layer2: { applicable: true },
        waivers: [],
      }),
    );

    const result = await checkStepCompletion(fixture.dir, WIRING_CHECK, {
      getHeadSha: async () => fixture.head,
    });

    expect(result.done).toBe(false);
    expect(result.reason ?? '').toContain('task "1"');
    expect(result.reason ?? '').toContain('future-proof');
  });

  it('fails closed when a claimed same-file proof was persisted for a stale HEAD', async () => {
    const fixture = await initCompositionFixture();
    dirs.push(fixture.dir);
    await mkdir(join(fixture.dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(fixture.dir, '.pipeline', 'wiring-evidence.json'),
      JSON.stringify({
        schema: 1,
        base: fixture.base,
        head: 'stale-proof-head',
        tasks: [
          {
            id: '1',
            contract: 'src/composed.ts#productionCaller',
            gaps: [],
            proofs: [
              {
                kind: 'same-file-composition',
                export: 'composedHelper',
                caller: 'productionCaller',
                file: 'src/composed.ts',
                rootChain: ['src/root.ts', 'src/composed.ts'],
              },
            ],
          },
        ],
        layer2: { applicable: true },
        waivers: [],
      }),
    );

    const result = await checkStepCompletion(fixture.dir, WIRING_CHECK, {
      getHeadSha: async () => fixture.head,
    });

    expect(result.done).toBe(false);
    expect(result.reason ?? '').toContain('evidence recorded for stale-proof-head');
    expect(result.reason ?? '').toContain(`HEAD is ${fixture.head}`);
  });
});

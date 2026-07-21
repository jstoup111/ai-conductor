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
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { checkStepCompletion } from '../../src/engine/artifacts.js';
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

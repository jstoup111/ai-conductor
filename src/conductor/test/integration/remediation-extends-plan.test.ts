import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

import { parsePlanTaskPaths } from '../../src/engine/autoheal.js';
import type { RemediationGap } from '../../src/engine/artifacts.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED integration specs for "Remediation tasks are plan tasks with
// deterministic, parseable ids" (ADR H3/H9,
// .docs/stories/prd-audit-kickback-preserves-task-status.md, plan Tasks
// 18–21), centered on plan Task 21's "Remediation end-to-end": gap → plan
// append → re-seed → trailer commit → gate passes, in one isolated real repo,
// driving REAL production entry points rather than asserting a helper's
// return value in isolation.
//
// ASSUMPTION (flagged, low confidence — no ADR/plan text pins the exact
// symbol): the plan (Task 19: "the append helper + tests… `src/conductor/src/
// engine/` (append helper near `planRemediation`)") does not name the new
// module or export. `planRemediation` itself is a private Conductor method in
// conductor.ts, not an importable sibling module, so there is nothing to
// verify this guess against. This spec targets a plausible planned shape:
//
//   export function appendRemediationTasks(
//     planText: string,
//     gaps: RemediationGap[],
//     gateSource: string,
//   ): { planText: string; ids: string[] }
//
// in a new `src/conductor/src/engine/remediation-append.ts` module — pure
// (string in, string out) so the caller re-reads/re-writes the plan file and
// the test can drive the real plan file on disk. If the real implementation
// lands with a different name/shape, this whole file's RED reason will still
// be "module or export not found" (safe), but every assertion on the RETURN
// shape (ids, upsert semantics) below is a guess that must be re-verified
// once Task 19 lands — do not treat this file as load-bearing proof of the
// eventual API.
//
// `seedTaskStatus` (plan Task 5, new `task-seed.ts`) also does not exist yet.
// Both are dynamically imported per the `rekick-shipped-skip` convention.
// ─────────────────────────────────────────────────────────────────────────────

const execFile = promisify(execFileCb);
const REMEDIATION_APPEND_MOD = '../../src/engine/remediation-append.js';
const TASK_SEED_MOD = '../../src/engine/task-seed.js';

interface AppendResult {
  planText: string;
  ids: string[];
}

type AppendFn = (
  planText: string,
  gaps: RemediationGap[],
  gateSource: string,
) => AppendResult;

async function loadAppendRemediationTasks(): Promise<AppendFn> {
  const mod = (await import(REMEDIATION_APPEND_MOD)) as Record<string, unknown>;
  const fn = mod.appendRemediationTasks;
  if (typeof fn !== 'function') {
    throw new Error(
      'expected export "appendRemediationTasks" from remediation-append.ts to be a function (not yet implemented)',
    );
  }
  return fn as AppendFn;
}

// seedTaskStatus (Slice 1, landed) returns void and writes
// .pipeline/task-status.json on disk — the earlier guessed {tasks} return
// shape in this file's header is resolved against the real API here.
async function loadSeedTaskStatus(): Promise<
  (projectRoot: string, planPath: string) => Promise<void>
> {
  const mod = (await import(TASK_SEED_MOD)) as Record<string, unknown>;
  const fn = mod.seedTaskStatus;
  if (typeof fn !== 'function') {
    throw new Error(
      'expected export "seedTaskStatus" from task-seed.ts to be a function (not yet implemented)',
    );
  }
  return fn as (projectRoot: string, planPath: string) => Promise<void>;
}

async function readSeededTasks(projectRoot: string): Promise<Array<{ id: string; status: string }>> {
  const raw = await readFile(join(projectRoot, '.pipeline/task-status.json'), 'utf-8');
  const parsed = JSON.parse(raw) as { tasks?: Array<{ id: string; status: string }> };
  return parsed.tasks ?? [];
}

function gap(id: string, title: string, rationale = 'residual gap'): RemediationGap {
  return { id, disposition: 'build', category: null, rationale, tasks: [{ id, title }] };
}

let dir: string;
let planPath: string;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFile(
    'git',
    ['-c', 'user.email=t@test', '-c', 'user.name=t', ...args],
    { cwd: dir },
  );
  return stdout.trim();
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'remediation-extends-plan-'));
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  await mkdir(join(dir, '.docs/plans'), { recursive: true });
  planPath = join(dir, '.docs/plans/p.md');
  await writeFile(planPath, '### Task 1\n**Files:** `src/a.ts`\n');
  await git('init', '-q');
  await writeFile(join(dir, 'README.md'), 'init\n');
  await git('add', 'README.md');
  await git('commit', '-q', '-m', 'init');
  await git('remote', 'add', 'origin', dir);
  await git('update-ref', 'refs/remotes/origin/main', 'HEAD');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('integration: remediation extends the plan, end-to-end (H3/H9, plan Task 21)', () => {
  it('happy: gap → plan append → re-seed shows pending → trailer commit → gate/derive passes', async () => {
    const appendRemediationTasks = await loadAppendRemediationTasks();
    const seedTaskStatus = await loadSeedTaskStatus();

    const gaps = [gap('fr10-1', 'wire the missing validation')];
    const { planText: newPlanText, ids } = appendRemediationTasks(
      await readFile(planPath, 'utf-8'),
      gaps,
      'prd-audit',
    );
    expect(ids).toHaveLength(1);
    const remId = ids[0];
    // Deterministic and parseable: parsePlanTaskPaths must round-trip the id.
    await writeFile(planPath, newPlanText);
    const parsed = parsePlanTaskPaths(newPlanText);
    expect(parsed.has(remId)).toBe(true);

    // Re-seed picks up the new plan row as pending.
    await seedTaskStatus(dir, planPath);
    const remRow = (await readSeededTasks(dir)).find((t) => t.id === remId);
    expect(remRow).toBeDefined();
    expect(remRow!.status).toBe('pending');

    // A real trailer-stamped commit completes it end-to-end.
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/remediated.ts'), 'fix\n');
    await git('add', '.');
    await git('commit', '-q', '-m', `fix: remediate fr10-1\n\nTask: ${remId}`);

    const { deriveCompletion } = (await import('../../src/engine/autoheal.js')) as unknown as {
      deriveCompletion: (
        root: string,
        plan: string,
      ) => Promise<Record<string, { completed: boolean }>>;
    };
    const derived = await deriveCompletion(dir, planPath);
    expect(derived[remId]?.completed).toBe(true);
  });

  it('negative: a completed remediation task re-deriving the same id for DIFFERENT content is never mutated (bumped id instead)', async () => {
    const appendRemediationTasks = await loadAppendRemediationTasks();

    const originalText = await readFile(planPath, 'utf-8');
    const first = appendRemediationTasks(originalText, [gap('fr10-1', 'first fix')], 'prd-audit');
    const remId = first.ids[0];

    // Simulate the task already completed with evidence (as task-status.json
    // would record post-derive).
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify({ tasks: [{ id: remId, status: 'completed', evidencedBy: 'abc1234' }] }),
    );

    // A later round re-derives the SAME id for a DIFFERENT residual gap
    // (content drift) — the upsert must not silently overwrite the completed
    // row's content/meaning; it must produce a bumped/suffixed id instead.
    const second = appendRemediationTasks(
      first.planText,
      [gap('fr10-1', 'a totally different fix for a different residual gap')],
      'prd-audit',
    );
    expect(second.ids).toHaveLength(1);
    expect(second.ids[0]).not.toBe(remId);

    // The original completed row's plan text is untouched.
    expect(second.planText).toContain(remId);
  });

  it('negative: two different gate sources deriving colliding ids stay distinct via gate-source prefix', async () => {
    const appendRemediationTasks = await loadAppendRemediationTasks();
    const originalText = await readFile(planPath, 'utf-8');

    const fromPrdAudit = appendRemediationTasks(
      originalText,
      [gap('10-1', 'gap from prd-audit')],
      'prd-audit',
    );
    const fromTest = appendRemediationTasks(
      fromPrdAudit.planText,
      [gap('10-1', 'gap from test gate — same raw id, different source')],
      'test',
    );

    expect(fromTest.ids).toHaveLength(1);
    expect(fromTest.ids[0]).not.toBe(fromPrdAudit.ids[0]);
    // Both ids remain present in the plan (neither one clobbered the other).
    expect(fromTest.planText).toContain(fromPrdAudit.ids[0]);
    expect(fromTest.planText).toContain(fromTest.ids[0]);
  });

  it('negative: an empty/missing id in the gap is REJECTED — plan-append never writes an unaddressable task', async () => {
    const appendRemediationTasks = await loadAppendRemediationTasks();
    const originalText = await readFile(planPath, 'utf-8');

    const badGap: RemediationGap = {
      id: '',
      disposition: 'build',
      category: null,
      rationale: 'no id at all',
      tasks: [{ id: '', title: 'unaddressable task' }],
    };

    expect(() => appendRemediationTasks(originalText, [badGap], 'prd-audit')).toThrow();
  });
});

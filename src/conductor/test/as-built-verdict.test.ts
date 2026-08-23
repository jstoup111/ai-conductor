import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkStepCompletion } from '../src/engine/artifacts.js';
import { Conductor, type StepRunner } from '../src/engine/conductor.js';
import { ALL_STEPS } from '../src/engine/steps.js';
import { writeState } from '../src/engine/state.js';
import type { ConductState, StepName } from '../src/types/index.js';
import { ConductorEventEmitter } from '../src/ui/events.js';

const dirs: string[] = [];

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'as-built-verdict-'));
  dirs.push(dir);
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  return dir;
}

async function writeAsBuilt(dir: string, body: string): Promise<void> {
  await writeFile(join(dir, '.pipeline', 'architecture-review-as-built.md'), body);
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('as-built verdict gate', () => {
  it('accepts a delivered PLAN_GAP as a recorded non-blocking verdict', async () => {
    const dir = await fixture();
    await writeAsBuilt(dir, 'Verdict: PLAN_GAP\nOutcome delivered: yes\n\n## Recorded Findings\n- Plan is the limit.\n');

    await expect(
      checkStepCompletion(dir, 'architecture_review_as_built', { sessionStartedAt: Date.now() - 1_000 }),
    ).resolves.toMatchObject({ done: true });
  });

  it('keeps undelivered PLAN_GAP, BLOCKED, and missing verdict reports unsatisfied', async () => {
    const dir = await fixture();
    const ctx = { sessionStartedAt: Date.now() - 1_000 };

    await writeAsBuilt(dir, 'Verdict: PLAN_GAP\nOutcome delivered: no\n');
    await expect(checkStepCompletion(dir, 'architecture_review_as_built', ctx)).resolves.toMatchObject({ done: false });

    await writeAsBuilt(dir, 'Verdict: BLOCKED\n');
    await expect(checkStepCompletion(dir, 'architecture_review_as_built', ctx)).resolves.toMatchObject({ done: false });

    await writeAsBuilt(dir, '# As-built review\n');
    await expect(checkStepCompletion(dir, 'architecture_review_as_built', ctx)).resolves.toMatchObject({ done: false });
  });
});

describe('as-built SHIP routing', () => {
  it('plans only the prd_audit FIXABLE task, then halts the validation group on as-built BLOCKED without a BUILD kickback', async () => {
    const dir = await fixture();
    const pipeline = join(dir, '.pipeline');
    const statePath = join(pipeline, 'conduct-state.json');
    const slug = 'as-built-verdict';
    await Promise.all([
      mkdir(join(dir, '.docs', 'plans'), { recursive: true }),
      mkdir(join(dir, '.docs', 'stories'), { recursive: true }),
      mkdir(join(dir, '.docs', 'specs'), { recursive: true }),
    ]);
    await writeFile(join(dir, '.docs', 'plans', `${slug}.md`), '# Plan\n\n### Task 1: existing work\n\n**Files:** src/feature.ts\n\n**Criterion:** S1.1\n');
    await writeFile(join(dir, '.docs', 'stories', `${slug}.md`), '# Stories\n\n## Story 1\n\n### Acceptance Criteria\n\n- **S1.1:** Given x, when y, then z.\n');
    await writeFile(join(dir, '.docs', 'specs', `${slug}.md`), '# PRD\n\n## Functional Requirements\n\n- **FR-1:** The requested result exists.\n');
    await writeFile(join(pipeline, 'task-status.json'), JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }));

    const fromIndex = ALL_STEPS.findIndex((step) => step.name === 'manual_test');
    const state: Record<string, unknown> = {
      feature_desc: slug,
      complexity_tier: 'L',
      track: 'product',
      run_started_at: Date.now() - 1_000,
    };
    for (const [index, step] of ALL_STEPS.entries()) state[step.name] = index < fromIndex ? 'done' : 'pending';
    state.retro = 'skipped';
    state.rebase = 'done';
    state.finish = 'done';
    await writeState(statePath, state as ConductState);

    const calls: StepName[] = [];
    const events = new ConductorEventEmitter();
    const kicks: Array<{ from: string; to: string }> = [];
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kicks.push({ from: event.from, to: event.to });
    });
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        calls.push(step);
        if (step === 'manual_test') {
          await writeFile(join(pipeline, 'manual-test-results.md'), '| Story | Result |\n|---|---|\n| S1 | PASS |\n');
        } else if (step === 'prd_audit') {
          await writeFile(join(pipeline, 'prd-audit.md'), [
            '**PRD:** present',
            '',
            '## Verdict Table',
            '| Criterion | Grade | Plan task | Evidence |',
            '|---|---|---|---|',
            '| S1.1 | FIXABLE | 1 | Missing implementation |',
            '',
            '## FR Evidence',
            '| FR | Verdict | Gap-class | Evidence | Accepted? |',
            '|---|---|---|---|---|',
            '| FR-1 | MISSING | impl-gap | src/feature.ts:1 | no |',
          ].join('\n'));
        } else if (step === 'architecture_review_as_built') {
          await writeAsBuilt(dir, 'Verdict: BLOCKED\n');
        } else if (step === 'remediate') {
          await writeFile(join(pipeline, 'remediation.json'), JSON.stringify({
            dispositions: [{
              id: 'S1.1',
              disposition: 'build',
              category: null,
              rationale: 'implement the existing planned task',
              tasks: [{ id: 'S1.1-fix', title: 'Implement the missing planned behavior' }],
            }],
          }));
        }
        return { success: true };
      }),
      resetSession: async () => {},
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      fromStep: 'manual_test',
      verifyArtifacts: true,
      maxRetries: 1,
      config: {
        prd_audit: { max_appended_ratio: 1 },
      } as never,
      git: async (args) => args.includes('--symbolic-full-name') ? { stdout: 'refs/remotes/origin/feature/as-built-verdict\n' } : { stdout: '' },
    });

    await conductor.run();

    expect(calls).toContain('remediate');
    expect(calls).not.toContain('build');
    expect(kicks).not.toContainEqual(expect.objectContaining({ to: 'build' }));
    await expect(readFile(join(pipeline, 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    await expect(readFile(join(dir, '.docs', 'plans', `${slug}.md`), 'utf8')).resolves.toContain('rem-prd-audit-S1.1-fix');
  });
});

/**
 * Covers: S7.1, S7.2, S7.3, S7.4, S7.5, task:13
 *
 * A real local Git repository supplies the Task-trailer boundary. The spec
 * drives the production daemon-state, task-seed, resume-selection, backlog,
 * and scheduler entry points while replacing the feature executor itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findResumeIndex } from '../../src/engine/conductor.js';
import {
  discoverBacklog,
  type BacklogTreeSource,
} from '../../src/engine/daemon-backlog.js';
import { preparePipelineForDaemonDispatch } from '../../src/engine/daemon-dispatch-preparation.js';
import { deriveDaemonBaseState, persistDaemonBaseState } from '../../src/engine/daemon-state.js';
import { runDaemon } from '../../src/engine/daemon.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { seedTaskStatus } from '../../src/engine/task-seed.js';
import type { ConductState } from '../../src/types/index.js';

interface TaskRow {
  id: string;
  name: string;
  status: 'pending' | 'in_progress' | 'completed';
  commit?: string;
}

interface TaskStatusFixture {
  plan_ref?: string;
  tasks: TaskRow[];
}

const FEATURE = 'daemon-death-resume';
const PLAN_REL = `.docs/plans/${FEATURE}.md`;

function workingTreeSource(root: string): BacklogTreeSource {
  const list = async (directory: string): Promise<string[]> => {
    try {
      return (await readdir(join(root, directory))).filter((entry) => entry.endsWith('.md'));
    } catch {
      return [];
    }
  };
  return {
    listPlanFiles: () => list('.docs/plans'),
    listShippedFiles: () => list('.docs/shipped'),
    listAdrFiles: () => list('.docs/decisions'),
    async readFile(relativePath) {
      try {
        return await readFile(join(root, relativePath), 'utf8');
      } catch {
        return null;
      }
    },
  };
}

async function git(root: string, args: string[]): Promise<string> {
  const result = await execa('git', args, { cwd: root });
  return result.stdout.trim();
}

function renderPlan(total = 25): string {
  const tasks = Array.from(
    { length: total },
    (_, index) => `### Task ${index + 1}: Work ${index + 1}\n**Dependencies:** none\n`,
  );
  return [
    '# Plan',
    `**Stories:** .docs/stories/${FEATURE}.md`,
    '',
    ...tasks,
    '## Task Dependency Graph',
    '',
    'Task 1 (independent)',
    '',
  ].join('\n');
}

async function initializeRepository(root: string): Promise<void> {
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['config', 'user.email', 'test@example.com']);
  await git(root, ['config', 'user.name', 'Test User']);
  await writeFile(join(root, 'README.md'), '# fixture\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '-q', '-m', 'initial fixture']);
}

async function commitTasks(root: string, count: number): Promise<Map<string, string>> {
  const commits = new Map<string, string>();
  for (let index = 1; index <= count; index += 1) {
    const path = `task-${index}.txt`;
    await writeFile(join(root, path), `task ${index}\n`);
    await git(root, ['add', path]);
    await git(root, ['commit', '-q', '-m', `feat: task ${index}`, '-m', `Task: ${index}`]);
    commits.set(String(index), await git(root, ['rev-parse', 'HEAD']));
  }
  return commits;
}

async function writeTaskStatus(root: string, rows: TaskRow[]): Promise<void> {
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await writeFile(
    join(root, '.pipeline/task-status.json'),
    `${JSON.stringify({ plan_ref: PLAN_REL, tasks: rows }, null, 2)}\n`,
  );
}

async function readTaskStatus(root: string): Promise<TaskStatusFixture> {
  return JSON.parse(await readFile(join(root, '.pipeline/task-status.json'), 'utf8')) as TaskStatusFixture;
}

describe('Story 7 — a feature interrupted by daemon death resumes committed progress', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'daemon-death-resume-'));
    await initializeRepository(root);
    await mkdir(join(root, '.docs/plans'), { recursive: true });
    await writeFile(join(root, PLAN_REL), renderPlan());
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('resumes at task 19 without rewriting completed rows or pre-kill pipeline evidence', async () => {
    const commits = await commitTasks(root, 18);
    const completedRows = Array.from({ length: 18 }, (_, index): TaskRow => ({
      id: String(index + 1),
      name: `Work ${index + 1}`,
      status: 'completed',
      commit: commits.get(String(index + 1)),
    }));
    await writeTaskStatus(root, [
      ...completedRows,
      { id: '19', name: 'Work 19', status: 'in_progress' },
      ...Array.from({ length: 6 }, (_, index): TaskRow => ({
        id: String(index + 20),
        name: `Work ${index + 20}`,
        status: 'pending',
      })),
    ]);

    const pipeline = join(root, '.pipeline');
    const state: ConductState = {
      complexity_tier: 'M',
      track: 'technical',
      feature_desc: FEATURE,
      worktree: 'done',
      memory: 'done',
      explore: 'skipped',
      complexity: 'skipped',
      prd: 'skipped',
      architecture_diagram: 'done',
      architecture_review: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done',
      coherence_check: 'done',
      coverage_binding: 'done',
      acceptance_specs: 'done',
      build: 'in_progress',
      last_step: 'acceptance_specs',
    };
    const eventsBefore = '{"type":"step_completed","step":"acceptance_specs"}\n';
    const stateBefore = `${JSON.stringify(state, null, 2)}\n`;
    await writeFile(join(pipeline, 'events.jsonl'), eventsBefore);
    await writeFile(join(pipeline, 'conduct-state.json'), stateBefore);
    await writeFile(join(pipeline, 'session-created'), 'stale-session\n');
    const completedBefore = completedRows.map((row) => JSON.stringify(row));

    await preparePipelineForDaemonDispatch(pipeline);
    const resumedState = deriveDaemonBaseState(state, { slug: FEATURE, tier: 'M', track: 'technical' }, () => ({
      worktree: 'done',
      memory: 'done',
    }));
    await persistDaemonBaseState(join(pipeline, 'conduct-state.json'), state, resumedState);
    await seedTaskStatus(root, PLAN_REL);

    const seeded = await readTaskStatus(root);
    expect(seeded.tasks.slice(0, 18).map((row) => JSON.stringify(row))).toEqual(completedBefore);
    expect(seeded.tasks.find((row) => row.status !== 'completed')?.id).toBe('19');
    expect(await readFile(join(pipeline, 'events.jsonl'), 'utf8')).toBe(eventsBefore);
    expect(await readFile(join(pipeline, 'conduct-state.json'), 'utf8')).toBe(stateBefore);

    const resumeIndex = findResumeIndex(resumedState, ALL_STEPS);
    expect(ALL_STEPS[resumeIndex]?.name).toBe('build');
    expect(ALL_STEPS.slice(0, resumeIndex).some((step) => step.phase === 'DECIDE')).toBe(true);
  });

  it('restores a missing completed row from its Task trailer', async () => {
    const commits = await commitTasks(root, 18);
    const rows = Array.from({ length: 25 }, (_, index): TaskRow => {
      const id = String(index + 1);
      if (id === '18') return { id, name: 'Work 18', status: 'pending' };
      if (index < 17) {
        return { id, name: `Work ${id}`, status: 'completed', commit: commits.get(id) };
      }
      return { id, name: `Work ${id}`, status: 'pending' };
    });
    await writeTaskStatus(root, rows.filter((row) => row.id !== '18'));

    await seedTaskStatus(root, PLAN_REL);

    const seeded = await readTaskStatus(root);
    expect(seeded.tasks.find((row) => row.id === '18')).toMatchObject({
      status: 'completed',
      commit: commits.get('18'),
    });
  });

  it('resets an uncommitted in-flight task to pending for redispatch', async () => {
    await writeTaskStatus(
      root,
      Array.from({ length: 25 }, (_, index): TaskRow => ({
        id: String(index + 1),
        name: `Work ${index + 1}`,
        status: index === 18 ? 'in_progress' : 'pending',
      })),
    );

    await seedTaskStatus(root, PLAN_REL);

    const seeded = await readTaskStatus(root);
    expect(seeded.tasks.find((row) => row.id === '19')).toMatchObject({ status: 'pending' });
  });

  it('dispatches the unfinished feature on the next poll when daemon death left no HALT', async () => {
    await mkdir(join(root, '.docs/stories'), { recursive: true });
    await mkdir(join(root, '.docs/complexity'), { recursive: true });
    await mkdir(join(root, '.docs/coherence'), { recursive: true });
    await mkdir(join(root, '.worktrees', FEATURE, '.pipeline'), { recursive: true });
    await writeFile(join(root, `.docs/stories/${FEATURE}.md`), '**Status:** Accepted\n# Stories\n');
    await writeFile(join(root, `.docs/complexity/${FEATURE}.md`), '# Complexity\n\nTier: M\n');
    await writeFile(
      join(root, `.docs/coherence/${FEATURE}.md`),
      '| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |\n' +
        '|---|---|---|---|---|\n' +
        '| story | S7 | Task 13 | covered | resume proof |\n',
    );
    const haltPath = join(root, '.worktrees', FEATURE, '.pipeline/HALT');
    const dispatched = vi.fn(async () => ({ slug: FEATURE, status: 'done' as const }));

    const result = await runDaemon(
      {
        discoverBacklog: async () => (
          await discoverBacklog(root, async () => false, undefined, {
            treeSource: workingTreeSource(root),
          })
        ).items,
        runFeature: dispatched,
        isHalted: async () => false,
      },
      { concurrency: 1, once: true },
    );

    expect(dispatched).toHaveBeenCalledOnce();
    expect(dispatched).toHaveBeenCalledWith(expect.objectContaining({ slug: FEATURE }));
    expect(result.processed).toEqual([expect.objectContaining({ slug: FEATURE, status: 'done' })]);
    await expect(readFile(haltPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

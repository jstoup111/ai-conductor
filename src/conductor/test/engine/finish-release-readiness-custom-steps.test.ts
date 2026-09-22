// Covers: task:3
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/engine/config.js';
import {
  createProductionFinishPublicationCoordinator,
  createProductionReleaseReadinessObserver,
} from '../../src/engine/finish-publication-production.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { ConductState } from '../../src/types/index.js';

const runStartedAt = Date.UTC(2026, 8, 22, 12, 0, 0);

function customConfig(names: readonly string[]): HarnessConfig {
  return {
    steps: Object.fromEntries(names.map((name, index) => [name, {
      after: index === 0 ? 'rebase' : names[index - 1]!,
      skill: `${name}/SKILL.md`, enforcement: 'gating',
      completion_artifact: `.pipeline/${name}-pass`,
    }])),
  };
}

async function freshMarker(root: string, name: string): Promise<void> {
  const marker = join(root, '.pipeline', `${name}-pass`);
  await writeFile(marker, 'PASS\n');
  await utimes(marker, new Date(runStartedAt + 1), new Date(runStartedAt + 1));
}

function doneState(names: readonly string[]): ConductState {
  return {
    ...Object.fromEntries(names.map((name) => [name, 'done'])),
    run_started_at: runStartedAt,
  } as ConductState;
}

async function advanceCoordinatorWithFreshCustomGates(root: string, names: readonly string[]) {
  const trace: string[] = [];
  const observer = createProductionReleaseReadinessObserver({ projectRoot: root, config: customConfig(names) });
  const coordinator = createProductionFinishPublicationCoordinator({
    projectRoot: root,
    stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
    baseBranch: 'main',
    git: async (args) => {
      trace.push(`git:${args.join(' ')}`);
      if (args[0] === 'rev-list') return { stdout: '1\n' };
      if (args[0] === 'rev-parse') return { stdout: 'refs/remotes/origin/feat/feature\n' };
      return { stdout: '' };
    },
    gh: async (args) => {
      trace.push(`gh:${args.join(' ')}`);
      if (args[0] === 'pr' && args[1] === 'view') throw new Error('no open PR');
      if (args[0] === 'pr' && args[1] === 'create') return { stdout: 'https://github.com/acme/widget/pull/1172\n' };
      return { stdout: '' };
    },
    acquireInteractiveIntent: async () => 'pr',
    observeReleaseReadiness: async (state) => observer(state),
  });
  const result = await coordinator.advance({
    state: { ...doneState(names), feature_desc: 'feature', worktree_branch: 'feat/feature', build_review: 'done', test_suite: 'done', manual_test: 'done', architecture_review_as_built: 'done' } as ConductState,
    mode: 'interactive', daemon: false, dispatchJudgment: async () => ({ success: true }), emit: async () => {},
  });
  return { result, trace };
}

describe('production FINISH custom-step release readiness', () => {
  it('observes a fresh done compliance gate as present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-custom-readiness-'));
    try {
      await mkdir(join(root, '.pipeline'));
      const marker = join(root, '.pipeline', 'compliance-gate-pass');
      await writeFile(marker, 'PASS\n');
      await utimes(marker, new Date(runStartedAt + 1), new Date(runStartedAt + 1));
      const observe = createProductionReleaseReadinessObserver({
        projectRoot: root,
        config: {
          steps: {
            'compliance-gate': {
              after: 'rebase', skill: 'compliance/SKILL.md', enforcement: 'gating',
              completion_artifact: '.pipeline/compliance-gate-pass',
            },
          },
        },
      });

      await expect(observe({
        ...({ 'compliance-gate': 'done' } as Record<string, unknown>),
        run_started_at: runStartedAt,
      } as ConductState)).resolves.toEqual({ observation: 'present', steps: [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('observes two fresh done gating custom steps as present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-custom-readiness-'));
    try {
      await mkdir(join(root, '.pipeline'));
      await Promise.all(['compliance-gate', 'notes-gate'].map((name) => freshMarker(root, name)));

      await expect(createProductionReleaseReadinessObserver({
        projectRoot: root, config: customConfig(['compliance-gate', 'notes-gate']),
      })(doneState(['compliance-gate', 'notes-gate']))).resolves.toEqual({ observation: 'present', steps: [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not stat the filesystem when no custom prerequisite is selected', async () => {
    const lstat = vi.fn();
    vi.resetModules();
    vi.doMock('node:fs/promises', async () => ({
      ...await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises'),
      lstat,
    }));
    try {
      const { createProductionReleaseReadinessObserver: createObserver } = await import(
        '../../src/engine/finish-publication-production.js'
      );
      await expect(createObserver({ projectRoot: tmpdir(), config: {} })({} as ConductState))
        .resolves.toEqual({ observation: 'present', steps: [] });
      expect(lstat).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('node:fs/promises');
      vi.resetModules();
    }
  });

  it('observes this repository checked-in custom steps as present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-custom-readiness-'));
    try {
      const loaded = await loadConfig(join(process.cwd(), '../..'));
      if (!loaded.ok) throw new Error(loaded.error.message);
      await mkdir(join(root, '.pipeline'));
      await Promise.all(['maintain-documentation', 'release-disposition'].map((name) => freshMarker(root, name)));

      await expect(createProductionReleaseReadinessObserver({ projectRoot: root, config: loaded.config })(
        doneState(['maintain-documentation', 'release-disposition']),
      )).resolves.toEqual({ observation: 'present', steps: [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('passes a fresh done compliance gate through the production FINISH coordinator', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-custom-readiness-'));
    try {
      await mkdir(join(root, '.pipeline'));
      await freshMarker(root, 'compliance-gate');
      await expect(advanceCoordinatorWithFreshCustomGates(root, ['compliance-gate']))
        .resolves.toMatchObject({ result: { kind: 'publication_retry', transition: 'establish_pr' } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('passes two fresh done gates through the production FINISH coordinator', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-custom-readiness-'));
    try {
      await mkdir(join(root, '.pipeline'));
      const names = ['compliance-gate', 'notes-gate'];
      await Promise.all(names.map((name) => freshMarker(root, name)));
      await expect(advanceCoordinatorWithFreshCustomGates(root, names))
        .resolves.toMatchObject({ result: { kind: 'publication_retry', transition: 'establish_pr' } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

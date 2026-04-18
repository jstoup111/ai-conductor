import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { detectAutoResume } from '../../src/engine/auto-resume.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState } from '../../src/types/index.js';
import { slugify } from '../../src/engine/worktree.js';

describe('Integration: auto-resume by feature description', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'conduct-auto-resume-'));
    await mkdir(join(projectRoot, '.worktrees'), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function seedWorktree(
    featureDesc: string,
    state: ConductState,
    location: '.pipeline' | 'legacy' = '.pipeline',
  ): Promise<string> {
    const slug = slugify(featureDesc);
    const worktreePath = join(projectRoot, '.worktrees', slug);
    let statePath: string;
    if (location === '.pipeline') {
      await mkdir(join(worktreePath, '.pipeline'), { recursive: true });
      statePath = join(worktreePath, '.pipeline', 'conduct-state.json');
    } else {
      await mkdir(worktreePath, { recursive: true });
      statePath = join(worktreePath, 'conduct-state.json');
    }
    await writeState(statePath, state);
    return worktreePath;
  }

  it('returns kind=none when no worktree exists for the slug', async () => {
    const result = await detectAutoResume(projectRoot, 'brand new feature');
    expect(result.kind).toBe('none');
  });

  it('returns kind=none when a worktree exists but has empty state', async () => {
    // Worktree directory exists, no state written.
    await mkdir(join(projectRoot, '.worktrees', 'empty-feature', '.pipeline'), {
      recursive: true,
    });
    const result = await detectAutoResume(projectRoot, 'empty feature');
    expect(result.kind).toBe('none');
  });

  it('returns kind=resume for an in-progress .pipeline state', async () => {
    await seedWorktree('my feature', {
      feature_desc: 'my feature',
      complexity_tier: 'L',
      brainstorm: 'done',
      last_step: 'brainstorm',
    });

    const result = await detectAutoResume(projectRoot, 'my feature');
    expect(result.kind).toBe('resume');
    if (result.kind === 'resume') {
      expect(result.lastStep).toBe('brainstorm');
      expect(result.stepIndex).toBeGreaterThan(0);
      expect(result.featureDesc).toBe('my feature');
      expect(result.stateFilePath).toMatch(/\.pipeline\/conduct-state\.json$/);
    }
  });

  it('falls back to legacy state file in worktree root', async () => {
    await seedWorktree(
      'legacy feature',
      {
        feature_desc: 'legacy feature',
        brainstorm: 'done',
        last_step: 'brainstorm',
      },
      'legacy',
    );

    const result = await detectAutoResume(projectRoot, 'legacy feature');
    expect(result.kind).toBe('resume');
    if (result.kind === 'resume') {
      expect(result.stateFilePath).not.toMatch(/\.pipeline/);
      expect(result.stateFilePath).toMatch(/conduct-state\.json$/);
    }
  });

  it('prefers .pipeline state over legacy when both exist', async () => {
    const slug = slugify('both');
    const worktreePath = join(projectRoot, '.worktrees', slug);
    await mkdir(join(worktreePath, '.pipeline'), { recursive: true });
    await writeState(join(worktreePath, '.pipeline', 'conduct-state.json'), {
      feature_desc: 'pipeline version',
    });
    await writeState(join(worktreePath, 'conduct-state.json'), {
      feature_desc: 'legacy version',
    });

    const result = await detectAutoResume(projectRoot, 'both');
    expect(result.kind).toBe('resume');
    if (result.kind === 'resume') {
      expect(result.featureDesc).toBe('pipeline version');
      expect(result.stateFilePath).toMatch(/\.pipeline/);
    }
  });

  it('returns kind=complete for a finished feature', async () => {
    await seedWorktree('done feature', {
      feature_desc: 'done feature',
      feature_status: 'complete',
    });

    const result = await detectAutoResume(projectRoot, 'done feature');
    expect(result.kind).toBe('complete');
  });

  it('same description maps deterministically to the same worktree', async () => {
    const wt1 = await seedWorktree('Feature Description', {
      feature_desc: 'Feature Description',
      brainstorm: 'done',
      last_step: 'brainstorm',
    });

    const res1 = await detectAutoResume(projectRoot, 'Feature Description');
    const res2 = await detectAutoResume(projectRoot, 'feature description'); // case-insensitive slug
    const res3 = await detectAutoResume(projectRoot, 'Feature-Description');
    expect(res1.kind).toBe('resume');
    expect(res2.kind).toBe('resume');
    expect(res3.kind).toBe('resume');
    if (res1.kind === 'resume' && res2.kind === 'resume' && res3.kind === 'resume') {
      expect(res1.worktreePath).toBe(wt1);
      expect(res2.worktreePath).toBe(wt1);
      expect(res3.worktreePath).toBe(wt1);
    }
  });

  it('stepIndex matches the position AFTER lastStep', async () => {
    const { ALL_STEPS } = await import('../../src/engine/steps.js');
    const brainstormIdx = ALL_STEPS.findIndex((s) => s.name === 'brainstorm');
    await seedWorktree('with index', {
      feature_desc: 'with index',
      brainstorm: 'done',
      last_step: 'brainstorm',
    });

    const result = await detectAutoResume(projectRoot, 'with index');
    if (result.kind === 'resume') {
      expect(result.stepIndex).toBe(brainstormIdx + 1);
    }
  });

  describe('pre-worktree state at project root', () => {
    async function seedRoot(
      state: ConductState,
      location: '.pipeline' | 'legacy' = '.pipeline',
    ): Promise<string> {
      let statePath: string;
      if (location === '.pipeline') {
        await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
        statePath = join(projectRoot, '.pipeline', 'conduct-state.json');
      } else {
        statePath = join(projectRoot, 'conduct-state.json');
      }
      await writeState(statePath, state);
      return statePath;
    }

    it('resumes from project-root .pipeline/conduct-state.json when feature_desc matches', async () => {
      await seedRoot({
        feature_desc: 'same prompt',
        bootstrap: 'done',
        memory: 'done',
        last_step: 'memory',
      });

      const result = await detectAutoResume(projectRoot, 'same prompt');
      expect(result.kind).toBe('resume');
      if (result.kind === 'resume') {
        expect(result.worktreePath).toBe(projectRoot);
        expect(result.stateFilePath).toMatch(/\.pipeline\/conduct-state\.json$/);
        expect(result.lastStep).toBe('memory');
      }
    });

    it('falls back to legacy root conduct-state.json', async () => {
      await seedRoot(
        { feature_desc: 'legacy root', bootstrap: 'done', last_step: 'bootstrap' },
        'legacy',
      );
      const result = await detectAutoResume(projectRoot, 'legacy root');
      expect(result.kind).toBe('resume');
      if (result.kind === 'resume') {
        expect(result.stateFilePath).not.toMatch(/\.pipeline/);
      }
    });

    it('prefers .pipeline over legacy when both exist', async () => {
      await seedRoot({ feature_desc: 'pipeline wins' }, '.pipeline');
      await seedRoot({ feature_desc: 'legacy loses' }, 'legacy');
      const result = await detectAutoResume(projectRoot, 'pipeline wins');
      expect(result.kind).toBe('resume');
    });

    it('returns kind=complete for a finished root-level feature', async () => {
      await seedRoot({
        feature_desc: 'shipped',
        feature_status: 'complete',
      });
      const result = await detectAutoResume(projectRoot, 'shipped');
      expect(result.kind).toBe('complete');
    });

    it('ignores root state with a different feature_desc (checks worktrees instead)', async () => {
      await seedRoot({
        feature_desc: 'some other feature',
        bootstrap: 'done',
      });
      // No worktree for 'my feature' → falls through to kind=none.
      const result = await detectAutoResume(projectRoot, 'my feature');
      expect(result.kind).toBe('none');
    });

    it('matches root state even when the root dir is inside a git worktree tree (no slug worktree needed)', async () => {
      // Simulates: user runs `conduct "prompt"` in /tmp/harness-test, state
      // lives at /tmp/harness-test/.pipeline/, and no .worktrees/<slug>/ exists.
      await seedRoot({
        feature_desc: 'build a habit tracker API',
        bootstrap: 'done',
        memory: 'done',
        brainstorm: 'done',
        last_step: 'brainstorm',
      });
      const result = await detectAutoResume(projectRoot, 'build a habit tracker API');
      expect(result.kind).toBe('resume');
      if (result.kind === 'resume') {
        expect(result.worktreePath).toBe(projectRoot);
        expect(result.lastStep).toBe('brainstorm');
      }
    });
  });
});

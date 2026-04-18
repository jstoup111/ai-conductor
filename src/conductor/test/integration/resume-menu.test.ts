import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  scanResumableFeatures,
  selectFeature,
  type ResumableFeature,
} from '../../src/engine/resume.js';

describe('Integration: resume menu', () => {
  let tempDir: string;
  let worktreesDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'resume-menu-'));
    worktreesDir = join(tempDir, '.worktrees');
    await mkdir(worktreesDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('resume with single worktree auto-selects it', async () => {
    // Create one worktree dir with state
    const wtPath = join(worktreesDir, 'url-shortener');
    await mkdir(wtPath, { recursive: true });
    await writeFile(
      join(wtPath, 'conduct-state.json'),
      JSON.stringify({
        feature_desc: 'URL shortener service',
        last_step: 'plan',
        plan: 'done',
        brainstorm: 'done',
        complexity: 'done',
        stories: 'done',
        conflict_check: 'done',
        worktree: 'done',
        memory: 'done',
      }),
    );

    const features = await scanResumableFeatures(tempDir);
    expect(features).toHaveLength(1);

    const selected = selectFeature(features, undefined);
    expect(selected).not.toBeNull();
    expect(selected!.name).toBe('url-shortener');
    expect(selected!.path).toBe(wtPath);
  });

  it('resume with multiple worktrees shows menu', async () => {
    // Create two worktree dirs
    const wt1 = join(worktreesDir, 'url-shortener');
    await mkdir(wt1, { recursive: true });
    await writeFile(
      join(wt1, 'conduct-state.json'),
      JSON.stringify({
        feature_desc: 'URL shortener',
        last_step: 'plan',
        plan: 'in_progress',
        worktree: 'done',
        memory: 'done',
        brainstorm: 'done',
        complexity: 'done',
        stories: 'done',
        conflict_check: 'done',
      }),
    );

    const wt2 = join(worktreesDir, 'auth-system');
    await mkdir(wt2, { recursive: true });
    await writeFile(
      join(wt2, 'conduct-state.json'),
      JSON.stringify({
        feature_desc: 'Auth system',
        last_step: 'retro',
        retro: 'in_progress',
        worktree: 'done',
        memory: 'done',
        brainstorm: 'done',
        complexity: 'done',
        stories: 'done',
        conflict_check: 'done',
        plan: 'done',
        architecture_diagram: 'done',
        architecture_review: 'done',
        acceptance_specs: 'done',
        build: 'done',
        manual_test: 'done',
      }),
    );

    const features = await scanResumableFeatures(tempDir);
    expect(features).toHaveLength(2);

    // With multiple features, selectFeature without a choice returns null (needs user input)
    const selected = selectFeature(features, undefined);
    expect(selected).toBeNull();

    // With an explicit choice, it selects
    const chosen = selectFeature(features, 1);
    expect(chosen).not.toBeNull();
    expect(chosen!.name).toBe(features[0].name);

    const chosen2 = selectFeature(features, 2);
    expect(chosen2).not.toBeNull();
    expect(chosen2!.name).toBe(features[1].name);
  });

  it('resume with no worktrees shows error', async () => {
    const features = await scanResumableFeatures(tempDir);
    expect(features).toHaveLength(0);
  });

  it('resume excludes completed features', async () => {
    const wt1 = join(worktreesDir, 'done-feature');
    await mkdir(wt1, { recursive: true });
    await writeFile(
      join(wt1, 'conduct-state.json'),
      JSON.stringify({ feature_status: 'complete', feature_desc: 'Done feature' }),
    );

    const wt2 = join(worktreesDir, 'active-feature');
    await mkdir(wt2, { recursive: true });
    await writeFile(
      join(wt2, 'conduct-state.json'),
      JSON.stringify({ feature_desc: 'Active feature', last_step: 'brainstorm' }),
    );

    const features = await scanResumableFeatures(tempDir);
    expect(features).toHaveLength(1);
    expect(features[0].name).toBe('active-feature');
  });

  it('resume handles worktrees without state file', async () => {
    const wt = join(worktreesDir, 'no-state');
    await mkdir(wt, { recursive: true });
    // No conduct-state.json

    const features = await scanResumableFeatures(tempDir);
    // Should still include it (new worktree with no progress)
    expect(features).toHaveLength(1);
    expect(features[0].name).toBe('no-state');
    expect(features[0].lastStep).toBeUndefined();
  });

  it('selectFeature returns null for choice 0 (cancel)', () => {
    const features: ResumableFeature[] = [
      { name: 'feat-a', path: '/tmp/a', branch: 'feature/feat-a', stepIndex: 3, totalSteps: 14, lastStep: 'plan' },
    ];
    const selected = selectFeature(features, 0);
    expect(selected).toBeNull();
  });
});

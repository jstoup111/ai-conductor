import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  STEP_ARTIFACT_GLOBS,
  findArtifactFiles,
  stepHasArtifacts,
  getArtifactStatus,
} from '../../src/engine/artifacts.js';

describe('engine/artifacts', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'artifacts-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function createFile(relativePath: string, content = 'test') {
    const fullPath = join(dir, relativePath);
    const dirPath = fullPath.substring(0, fullPath.lastIndexOf('/'));
    await mkdir(dirPath, { recursive: true });
    await writeFile(fullPath, content);
  }

  describe('STEP_ARTIFACT_GLOBS', () => {
    it('declares plan output in .docs/plans/', () => {
      expect(STEP_ARTIFACT_GLOBS.plan).toEqual(['.docs/plans/*.md']);
    });

    it('declares stories output recursively in .docs/stories/', () => {
      expect(STEP_ARTIFACT_GLOBS.stories).toEqual(['.docs/stories/**/*.md']);
    });

    it('returns an empty list for steps that produce no artifacts', () => {
      expect(STEP_ARTIFACT_GLOBS.complexity).toEqual([]);
      expect(STEP_ARTIFACT_GLOBS.manual_test).toEqual([]);
      expect(STEP_ARTIFACT_GLOBS.finish).toEqual([]);
    });
  });

  describe('findArtifactFiles', () => {
    it('returns [] when the step produces no artifacts', async () => {
      expect(await findArtifactFiles(dir, 'complexity')).toEqual([]);
    });

    it('returns [] when no matching files exist', async () => {
      expect(await findArtifactFiles(dir, 'plan')).toEqual([]);
    });

    it('matches dir/*.ext patterns', async () => {
      await createFile('.docs/plans/2026-04-16-feature.md', 'plan');
      const files = await findArtifactFiles(dir, 'plan');
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/2026-04-16-feature\.md$/);
    });

    it('matches dir/**/*.ext patterns recursively', async () => {
      await createFile('.docs/stories/epic-1/story-a.md', 'story');
      await createFile('.docs/stories/epic-1/nested/story-b.md', 'story');
      const files = await findArtifactFiles(dir, 'stories');
      expect(files).toHaveLength(2);
    });

    it('matches multiple globs for architecture_review', async () => {
      await createFile('.docs/decisions/architecture-review-2026-04-16.md', 'rev');
      await createFile('.docs/decisions/adr-001.md', 'adr');
      const files = await findArtifactFiles(dir, 'architecture_review');
      expect(files).toHaveLength(2);
    });

    it('matches literal filenames', async () => {
      await createFile('.pipeline/task-status.json', '{}');
      const files = await findArtifactFiles(dir, 'build');
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/task-status\.json$/);
    });

    it('matches prefix globs like technical-assessment-*', async () => {
      await createFile('.docs/decisions/technical-assessment-2026-04-16.md', 'a');
      const files = await findArtifactFiles(dir, 'assess');
      expect(files).toHaveLength(1);
    });
  });

  describe('stepHasArtifacts', () => {
    it('returns true for steps that produce no artifacts (vacuous truth)', async () => {
      expect(await stepHasArtifacts(dir, 'complexity')).toBe(true);
      expect(await stepHasArtifacts(dir, 'manual_test')).toBe(true);
      expect(await stepHasArtifacts(dir, 'worktree')).toBe(true);
    });

    it('returns false when an artifact-producing step has no files', async () => {
      expect(await stepHasArtifacts(dir, 'plan')).toBe(false);
      expect(await stepHasArtifacts(dir, 'brainstorm')).toBe(false);
    });

    it('returns true once the expected file exists', async () => {
      await createFile('.docs/plans/2026-04-16-thing.md');
      expect(await stepHasArtifacts(dir, 'plan')).toBe(true);
    });
  });

  describe('getArtifactStatus', () => {
    it('returns [] for steps that produce no artifacts', async () => {
      expect(await getArtifactStatus(dir, 'complexity')).toEqual([]);
    });

    it('reports satisfied=false when the pattern has no matches', async () => {
      const status = await getArtifactStatus(dir, 'plan');
      expect(status).toHaveLength(1);
      expect(status[0]).toMatchObject({
        pattern: '.docs/plans/*.md',
        files: [],
        satisfied: false,
      });
    });

    it('reports satisfied=true with matched file paths relative to dir', async () => {
      await createFile('.docs/plans/2026-04-16-feature.md');
      const status = await getArtifactStatus(dir, 'plan');
      expect(status[0].satisfied).toBe(true);
      expect(status[0].files).toEqual(['.docs/plans/2026-04-16-feature.md']);
    });

    it('returns one status per glob pattern', async () => {
      await createFile('.docs/decisions/adr-001.md');
      const status = await getArtifactStatus(dir, 'architecture_review');
      expect(status).toHaveLength(2);
      const adrMatch = status.find((s) => s.pattern.includes('adr-'));
      const reviewMatch = status.find((s) => s.pattern.includes('architecture-review-'));
      expect(adrMatch?.satisfied).toBe(true);
      expect(reviewMatch?.satisfied).toBe(false);
    });
  });
});

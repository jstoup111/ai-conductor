import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  checkBrainstorm,
  checkStories,
  checkConflictCheck,
  checkPlan,
  checkBuild,
  checkAcceptanceSpecs,
  checkArchitectureDiagram,
  checkArchitectureReview,
  checkRetro,
  getArtifactChecker,
} from '../../src/engine/artifacts.js';

describe('engine/artifacts', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'artifacts-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Helper to create .docs directories and files
  async function createArtifact(relativePath: string, content = 'test') {
    const fullPath = join(dir, relativePath);
    const dirPath = fullPath.substring(0, fullPath.lastIndexOf('/'));
    await mkdir(dirPath, { recursive: true });
    await writeFile(fullPath, content);
  }

  // --- checkBrainstorm ---

  describe('checkBrainstorm', () => {
    it('returns false when no brainstorm doc exists', async () => {
      expect(await checkBrainstorm(dir)).toBe(false);
    });

    it('returns true when brainstorm doc exists', async () => {
      await createArtifact('.docs/brainstorm.md');
      expect(await checkBrainstorm(dir)).toBe(true);
    });
  });

  // --- checkStories ---

  describe('checkStories', () => {
    it('returns false when no stories dir exists', async () => {
      expect(await checkStories(dir)).toBe(false);
    });

    it('returns true when stories directory has files', async () => {
      await createArtifact('.docs/stories/story-1.md');
      expect(await checkStories(dir)).toBe(true);
    });

    it('returns false when stories directory exists but is empty', async () => {
      await mkdir(join(dir, '.docs/stories'), { recursive: true });
      expect(await checkStories(dir)).toBe(false);
    });
  });

  // --- checkConflictCheck ---

  describe('checkConflictCheck', () => {
    it('returns false when no conflict check doc exists', async () => {
      expect(await checkConflictCheck(dir)).toBe(false);
    });

    it('returns true when conflict check doc exists', async () => {
      await createArtifact('.docs/conflict-check.md');
      expect(await checkConflictCheck(dir)).toBe(true);
    });
  });

  // --- checkPlan ---

  describe('checkPlan', () => {
    it('returns false when no plan doc exists', async () => {
      expect(await checkPlan(dir)).toBe(false);
    });

    it('returns true when plan doc exists', async () => {
      await createArtifact('.docs/plan.md');
      expect(await checkPlan(dir)).toBe(true);
    });
  });

  // --- checkBuild ---

  describe('checkBuild', () => {
    it('returns false when no build artifacts exist', async () => {
      expect(await checkBuild(dir)).toBe(false);
    });

    it('returns true when task-status.json exists', async () => {
      await createArtifact('.docs/task-status.json', '{}');
      expect(await checkBuild(dir)).toBe(true);
    });
  });

  // --- checkAcceptanceSpecs ---

  describe('checkAcceptanceSpecs', () => {
    it('returns false when no spec files exist', async () => {
      expect(await checkAcceptanceSpecs(dir)).toBe(false);
    });

    it('returns true when spec files exist', async () => {
      await createArtifact('spec/acceptance/feature_spec.rb');
      expect(await checkAcceptanceSpecs(dir)).toBe(true);
    });

    it('returns true when test files exist in test dir', async () => {
      await createArtifact('test/acceptance/feature.test.ts');
      expect(await checkAcceptanceSpecs(dir)).toBe(true);
    });
  });

  // --- checkArchitectureDiagram ---

  describe('checkArchitectureDiagram', () => {
    it('returns false when no diagram exists', async () => {
      expect(await checkArchitectureDiagram(dir)).toBe(false);
    });

    it('returns true when architecture diagram exists', async () => {
      await createArtifact('.docs/architecture.md');
      expect(await checkArchitectureDiagram(dir)).toBe(true);
    });
  });

  // --- checkArchitectureReview ---

  describe('checkArchitectureReview', () => {
    it('returns false when no review exists', async () => {
      expect(await checkArchitectureReview(dir)).toBe(false);
    });

    it('returns true when architecture review exists', async () => {
      await createArtifact('.docs/architecture-review.md');
      expect(await checkArchitectureReview(dir)).toBe(true);
    });
  });

  // --- checkRetro ---

  describe('checkRetro', () => {
    it('returns false when no retro exists', async () => {
      expect(await checkRetro(dir)).toBe(false);
    });

    it('returns true when retro doc exists', async () => {
      await createArtifact('.docs/retro.md');
      expect(await checkRetro(dir)).toBe(true);
    });
  });

  // --- getArtifactChecker ---

  describe('getArtifactChecker', () => {
    it('returns a checker for brainstorm', async () => {
      const checker = getArtifactChecker('brainstorm');
      expect(await checker(dir)).toBe(false);
      await createArtifact('.docs/brainstorm.md');
      expect(await checker(dir)).toBe(true);
    });

    it('returns a checker for stories', async () => {
      const checker = getArtifactChecker('stories');
      expect(await checker(dir)).toBe(false);
      await createArtifact('.docs/stories/s1.md');
      expect(await checker(dir)).toBe(true);
    });

    it('returns a checker for build', async () => {
      const checker = getArtifactChecker('build');
      expect(await checker(dir)).toBe(false);
      await createArtifact('.docs/task-status.json', '{}');
      expect(await checker(dir)).toBe(true);
    });

    it('returns always-true for steps without artifacts (worktree)', async () => {
      const checker = getArtifactChecker('worktree');
      expect(await checker(dir)).toBe(true);
    });

    it('returns always-true for steps without artifacts (memory)', async () => {
      const checker = getArtifactChecker('memory');
      expect(await checker(dir)).toBe(true);
    });

    it('returns always-true for steps without artifacts (complexity)', async () => {
      const checker = getArtifactChecker('complexity');
      expect(await checker(dir)).toBe(true);
    });

    it('returns always-true for steps without artifacts (manual_test)', async () => {
      const checker = getArtifactChecker('manual_test');
      expect(await checker(dir)).toBe(true);
    });

    it('returns always-true for steps without artifacts (finish)', async () => {
      const checker = getArtifactChecker('finish');
      expect(await checker(dir)).toBe(true);
    });
  });
});

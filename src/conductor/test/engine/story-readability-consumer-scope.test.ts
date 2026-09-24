// Covers: S4.1, S4.3, S4.4, task:8
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { BacklogTreeSource } from '../../src/engine/backlog-tree-source.js';
import { discoverBacklog } from '../../src/engine/daemon-backlog.js';
import { checkGateCompletion } from '../../src/engine/gate-verdicts.js';
import {
  checkStepCompletion,
  extractAuthoritativeStoryCriteria,
} from '../../src/engine/artifacts.js';
import { assessAcceptedStoryReadability } from '../../src/engine/story-criteria.js';

const engineRoot = join(dirname(fileURLToPath(import.meta.url)), '../../src/engine');

const STORIES = `# Stories

**Status:** Accepted

## Story 1: Legacy merged work

### Happy Path
- Given existing merged work, when BUILD reads the artifact, then its existing lower-layer proof remains sufficient.
`;

const ZERO_CRITERIA_STORIES = `# Stories

**Status:** Accepted

## Story 1: Legacy merged work

### Happy Path
- Existing merged work remains sufficient.
`;

const PLAN = `# Implementation Plan

**Stories:** .docs/stories/merged-unreadable.md

### Task 1: Preserve existing behavior
**Dependencies:** none
`;

describe('accepted-story readability consumer scope', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function write(root: string, relativePath: string, content: string): Promise<void> {
    const path = join(root, relativePath);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, content);
  }

  async function seedBuildAndShipEvidence(root: string, stories = STORIES): Promise<void> {
    await write(root, '.docs/stories/merged-unreadable.md', stories);
    await write(root, 'test/existing-proof.ts', 'existing proof\n');
    const criteria = extractAuthoritativeStoryCriteria(stories);
    if (criteria.length === 0) {
      await write(root, 'test/merged-unreadable.acceptance.test.ts', 'acceptance proof\n');
      await write(root, '.pipeline/acceptance-specs-red.json', JSON.stringify({
        outcome: 'specs-generated',
        executed: 1,
        passed: 0,
        failed: 1,
        skipped: 0,
        errors: 0,
        command: 'test merged-unreadable.acceptance.test.ts',
        targetSpecs: ['test/merged-unreadable.acceptance.test.ts'],
        failingTests: [{ name: 'merged unreadable acceptance proof', reason: 'expected RED' }],
        ranAt: '2026-09-23T00:00:00.000Z',
        intentRationale: 'The fixture supplies valid BUILD evidence without making readability a requirement.',
      }));
    } else {
    await write(root, '.pipeline/acceptance-specs-red.json', JSON.stringify({
      outcome: 'disposition-only',
      dispositions: criteria.map((criterion) => ({
        criterion,
        disposition: 'existing-sufficient-test',
        citation: 'test/existing-proof.ts:1',
      })),
    }));
    }
    await write(root, '.pipeline/manual-test-results.md', '| Story | Result |\n| --- | --- |\n| Existing behavior | PASS |\n');
  }

  it('limits the readability predicate to land and the DECIDE stories gate', async () => {
    const sourcePaths = (await readdir(engineRoot, { recursive: true }))
      .filter((path) => path.endsWith('.ts'));
    const importers = (await Promise.all(sourcePaths.map(async (path) => ({
      path,
      source: await readFile(join(engineRoot, path), 'utf8'),
    })))).filter(({ source }) => /import\s*\{[^}]*\bassessAcceptedStoryReadability\b[^}]*\}\s*from\s*['"][^'"]*story-criteria\.js['"]/.test(source))
      .map(({ path }) => path)
      .sort();

    expect(importers).toEqual([
      'artifacts.ts',
      join('engineer', 'land-spec.ts'),
    ]);
  });

  it('keeps a merged unreadable story dispatchable while DECIDE remains the readability backstop', async () => {
    const root = await mkdtemp(join(tmpdir(), 'story-readability-consumer-scope-'));
    roots.push(root);
    await seedBuildAndShipEvidence(root);
    await write(root, '.docs/plans/merged-unreadable.md', PLAN);
    await write(root, '.docs/complexity/merged-unreadable.md', '# Complexity\n\nTier: S\n');

    expect(extractAuthoritativeStoryCriteria(STORIES)).toEqual([
      'Story 1 happy: Given existing merged work, when BUILD reads the artifact, then its existing lower-layer proof remains sufficient.',
    ]);
    expect(assessAcceptedStoryReadability(STORIES).firstUnreadableStoryId).toBe('1');
    await expect(checkGateCompletion(root, 'stories', { featureDesc: 'merged-unreadable' }))
      .resolves.toMatchObject({ done: false, reason: expect.stringMatching(/unreadable/i) });

    const files = new Map<string, string>([
      ['.docs/plans/merged-unreadable.md', PLAN],
      ['.docs/stories/merged-unreadable.md', STORIES],
      ['.docs/complexity/merged-unreadable.md', '# Complexity\n\nTier: S\n'],
    ]);
    const tree: BacklogTreeSource = {
      listPlanFiles: async () => ['merged-unreadable.md'],
      listShippedFiles: async () => [],
      listAdrFiles: async () => [],
      readFile: async (path) => files.get(path) ?? null,
    };
    const discovery = await discoverBacklog(root, undefined, undefined, {
      treeSource: tree,
      isOperatorParked: async () => false,
      writeBlockedSnapshot: async () => {},
    });

    expect(discovery.items.map(({ slug }) => slug)).toEqual(['merged-unreadable']);
    expect(discovery.blocked).toEqual([]);
  });

  it('does not make BUILD or SHIP refuse zero readable criteria or a missing Negative Paths section', async () => {
    const root = await mkdtemp(join(tmpdir(), 'story-readability-consumer-scope-'));
    roots.push(root);
    await seedBuildAndShipEvidence(root, ZERO_CRITERIA_STORIES);

    expect(extractAuthoritativeStoryCriteria(ZERO_CRITERIA_STORIES)).toEqual([]);
    expect(assessAcceptedStoryReadability(ZERO_CRITERIA_STORIES).firstUnreadableStoryId).toBe('1');

    await expect(
      checkStepCompletion(root, 'acceptance_specs', { featureDesc: 'merged-unreadable' }),
    ).resolves.toEqual({ done: true, viaException: false });
    await expect(checkStepCompletion(root, 'manual_test', { sessionStartedAt: 0 }))
      .resolves.toEqual({ done: true });
  });
});

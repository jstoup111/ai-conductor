// Covers: task:2

import { describe, expect, it } from 'vitest';
import type { BacklogTreeSource } from '../../src/engine/backlog-tree-source.js';
import {
  listBacklogCandidates,
  resolveCandidateStories,
  type BacklogCandidate,
} from '../../src/engine/daemon-backlog.js';

function tree(files: Record<string, string>): BacklogTreeSource {
  return {
    listPlanFiles: async () => Object.keys(files)
      .filter((path) => path.startsWith('.docs/plans/') && path.endsWith('.md'))
      .map((path) => path.slice('.docs/plans/'.length)),
    listFeatureManifests: async () => Object.keys(files)
      .filter((path) => /^\.docs\/[^/]+\/manifest\.json$/.test(path)),
    listShippedFiles: async () => [],
    listAdrFiles: async () => [],
    readFile: async (path) => files[path] ?? null,
  };
}

function manifest(slug: string, artifacts: Array<{ kind: string; path: string }>): string {
  return JSON.stringify({ schemaVersion: 1, slug, artifacts });
}

const legacy = (slug: string, stories: string) => ({
  [`.docs/plans/${slug}.md`]: `# Plan\n**Stories:** ${stories}\n`,
});

describe('daemon backlog candidate helpers', () => {
  it('lists deduplicated legacy plans and manifests in plan-file order', async () => {
    const source = tree({
      '.docs/plans/zeta.md': '# Plan',
      '.docs/plans/alpha.md': '# Plan',
      '.docs/shared/manifest.json': manifest('shared', []),
      '.docs/alpha/manifest.json': manifest('alpha', []),
    });

    await expect(listBacklogCandidates(source)).resolves.toEqual([
      { slug: 'alpha', planFile: 'alpha.md', manifestBacked: true },
      { slug: 'shared', manifestBacked: true },
      { slug: 'zeta', planFile: 'zeta.md', manifestBacked: false },
    ]);
  });

  it('resolves, rejects, and reports absent legacy Stories references', async () => {
    const resolved = await resolveCandidateStories(tree({
      ...legacy('resolved', '.docs/stories/resolved.md'),
      '.docs/stories/resolved.md': '# Stories',
    }), { slug: 'resolved', planFile: 'resolved.md', manifestBacked: false });
    const unresolvable = await resolveCandidateStories(tree(legacy('absolute', '/tmp/stories.md')),
      { slug: 'absolute', planFile: 'absolute.md', manifestBacked: false });
    const missing = await resolveCandidateStories(tree(legacy('missing', '.docs/stories/missing.md')),
      { slug: 'missing', planFile: 'missing.md', manifestBacked: false });

    expect([resolved, unresolvable, missing]).toEqual([
      {
        kind: 'resolved', planRel: '.docs/plans/resolved.md',
        planContent: '# Plan\n**Stories:** .docs/stories/resolved.md\n',
        storiesPath: '.docs/stories/resolved.md',
      },
      {
        kind: 'unresolvable', planRel: '.docs/plans/absolute.md',
        planContent: '# Plan\n**Stories:** /tmp/stories.md\n',
      },
      {
        kind: 'missing', planRel: '.docs/plans/missing.md',
        planContent: '# Plan\n**Stories:** .docs/stories/missing.md\n',
        source: 'plan-line', path: '.docs/stories/missing.md',
      },
    ]);
  });

  it('uses manifest Stories paths over an unresolvable plan line', async () => {
    const slug = 'manifest-resolved';
    const source = tree({
      [`.docs/${slug}/manifest.json`]: manifest(slug, [
        { kind: 'plan', path: `.docs/plans/${slug}.md` },
        { kind: 'stories', path: `.docs/stories/${slug}.md` },
      ]),
      ...legacy(slug, '/tmp/bad.md'),
      [`.docs/stories/${slug}.md`]: '# Stories',
    });

    await expect(resolveCandidateStories(source, {
      slug, planFile: `${slug}.md`, manifestBacked: true,
    })).resolves.toMatchObject({ kind: 'resolved', storiesPath: `.docs/stories/${slug}.md` });
  });

  it('reports missing and malformed manifest Story outcomes', async () => {
    const missingSlug = 'manifest-missing';
    const emptySlug = 'manifest-empty';
    const malformedSlug = 'manifest-malformed';
    const absentPlanSlug = 'manifest-no-plan';
    const source = tree({
      [`.docs/${missingSlug}/manifest.json`]: manifest(missingSlug, [
        { kind: 'plan', path: `.docs/plans/${missingSlug}.md` },
        { kind: 'stories', path: `.docs/stories/${missingSlug}.md` },
      ]),
      ...legacy(missingSlug, '.docs/stories/ignored.md'),
      [`.docs/${emptySlug}/manifest.json`]: manifest(emptySlug, [
        { kind: 'plan', path: `.docs/plans/${emptySlug}.md` },
      ]),
      ...legacy(emptySlug, '.docs/stories/ignored.md'),
      [`.docs/${malformedSlug}/manifest.json`]: '{ invalid json',
      [`.docs/${absentPlanSlug}/manifest.json`]: manifest(absentPlanSlug, [
        { kind: 'plan', path: `.docs/plans/${absentPlanSlug}.md` },
      ]),
    });
    const candidates: BacklogCandidate[] = [
      { slug: missingSlug, manifestBacked: true },
      { slug: emptySlug, manifestBacked: true },
      { slug: malformedSlug, manifestBacked: true },
      { slug: absentPlanSlug, manifestBacked: true },
    ];

    await expect(Promise.all(candidates.map((candidate) => resolveCandidateStories(source, candidate))))
      .resolves.toEqual([
        expect.objectContaining({ kind: 'missing', source: 'manifest', manifestPath: `.docs/${missingSlug}/manifest.json`, listed: [`.docs/stories/${missingSlug}.md`] }),
        expect.objectContaining({ kind: 'missing', source: 'manifest', manifestPath: `.docs/${emptySlug}/manifest.json`, listed: [] }),
        expect.objectContaining({ kind: 'malformed-manifest', manifestPath: `.docs/${malformedSlug}/manifest.json` }),
        { kind: 'no-plan' },
      ]);
  });
});

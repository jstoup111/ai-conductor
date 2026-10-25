// Covers: task:15

import { describe, expect, it } from 'vitest';
import type { BacklogTreeSource } from '../../src/engine/backlog-tree-source.js';
import { discoverBacklog } from '../../src/engine/daemon-backlog.js';

const PLAN = '# Plan\n### Task 1\n**Dependencies:** none\n';
const STORIES = '# Stories\n**Status:** Accepted\n';
const COHERENCE = '| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |\n|---|---|---|---|---|\n| story | S1 | Task 1 | covered | fixture |\n';

type ManifestTree = BacklogTreeSource & {
  listFeatureManifests(): Promise<string[]>;
  reads: string[];
};

function tree(files: Record<string, string>): ManifestTree {
  const reads: string[] = [];
  return {
    listPlanFiles: async () => Object.keys(files)
      .filter((path) => path.startsWith('.docs/plans/') && path.endsWith('.md'))
      .map((path) => path.slice('.docs/plans/'.length)),
    listFeatureManifests: async () => Object.keys(files)
      .filter((path) => /^\.docs\/[^/]+\/manifest\.json$/.test(path)),
    listShippedFiles: async () => [],
    listAdrFiles: async () => [],
    readFile: async (path) => {
      reads.push(path);
      return files[path] ?? null;
    },
    reads,
  };
}

function manifest(slug: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    slug,
    artifacts: [
      { kind: 'plan', path: `.docs/plans/${slug}.md` },
      { kind: 'stories', path: `.docs/stories/${slug}.md` },
      { kind: 'coherence', path: `.docs/coherence/${slug}.md` },
      { kind: 'complexity', path: `.docs/complexity/${slug}.md` },
      { kind: 'track', path: `.docs/track/${slug}.md` },
      { kind: 'applicability', path: `.docs/applicability/${slug}.md` },
      { kind: 'intake', path: `.docs/intake/${slug}.md` },
    ],
  });
}

function artifacts(slug: string): Record<string, string> {
  return {
    [`.docs/plans/${slug}.md`]: PLAN,
    [`.docs/stories/${slug}.md`]: STORIES,
    [`.docs/coherence/${slug}.md`]: COHERENCE,
    [`.docs/complexity/${slug}.md`]: 'Tier: M\n',
    [`.docs/track/${slug}.md`]: 'Track: technical\n',
    [`.docs/applicability/${slug}.md`]: 'Inapplicable: manual_test — no UI surface\n',
    [`.docs/intake/${slug}.md`]: 'Source-Ref: acme/project#7\n',
  };
}

describe('daemon backlog manifest discovery', () => {
  it('discovers a manifest-only feature and reads every listed discovery artifact', async () => {
    const source = tree({
      '.docs/f/manifest.json': manifest('f'),
      ...artifacts('f'),
    });

    const result = await discoverBacklog('/unused', undefined, undefined, { treeSource: source });

    expect(result.items).toEqual([expect.objectContaining({
      slug: 'f',
      planPath: '.docs/plans/f.md',
      storiesPath: '.docs/stories/f.md',
      tier: 'M',
      track: 'technical',
      sourceRef: 'acme/project#7',
    })]);
    expect(source.reads).toEqual(expect.arrayContaining([
      '.docs/f/manifest.json',
      '.docs/plans/f.md',
      '.docs/stories/f.md',
      '.docs/coherence/f.md',
      '.docs/complexity/f.md',
      '.docs/track/f.md',
      '.docs/applicability/f.md',
      '.docs/intake/f.md',
    ]));
  });

  it('deduplicates a manifest-backed feature whose legacy plan still exists', async () => {
    const source = tree({
      '.docs/f/manifest.json': manifest('f'),
      ...artifacts('f'),
    });

    const result = await discoverBacklog('/unused', undefined, undefined, { treeSource: source });
    const occurrences = [
      ...result.items.map((item) => item.slug),
      ...result.blocked.map((item) => item.slug),
      ...result.gated.filter((item): item is Extract<typeof item, { slug: string }> => 'slug' in item).map((item) => item.slug),
    ].filter((slug) => slug === 'f');

    expect(occurrences).toEqual(['f']);
  });

  it('preserves the frozen legacy discovery output and warning log', async () => {
    const source = tree(artifacts('legacy'));
    const logs: string[] = [];

    const result = await discoverBacklog('/unused', undefined, (line) => logs.push(line), {
      treeSource: source,
      writeBlockedSnapshot: async () => {},
    });

    expect({ result, logs }).toEqual({
      result: {
        items: [{
          slug: 'legacy',
          planPath: '.docs/plans/legacy.md',
          storiesPath: '.docs/stories/legacy.md',
          tier: 'M',
          track: 'technical',
          sourceRef: 'acme/project#7',
          applicabilityDeclarations: [],
          applicabilityBaseContentSha256: 'sha256:a2edc98ee2fb7a91184812601544af9707a272cde550581f36d9bd933e7b0140',
          applicabilityIgnored: { cause: 'toggle-off', steps: ['manual_test'] },
        }],
        waiting: [],
        blocked: [],
        gated: [],
      },
      logs: [],
    });
  });
});

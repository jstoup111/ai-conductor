// Covers: task:15, task:16, task:17

import { describe, expect, it } from 'vitest';
import type { BacklogTreeSource } from '../../src/engine/backlog-tree-source.js';
import { discoverBacklog } from '../../src/engine/daemon-backlog.js';
import { renderShippedRecord } from '../../src/engine/shipped-record.js';

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
    listShippedFiles: async () => Object.keys(files)
      .filter((path) => path.startsWith('.docs/shipped/') && path.endsWith('.md'))
      .map((path) => path.slice('.docs/shipped/'.length)),
    listAdrFiles: async () => [],
    readFile: async (path) => {
      reads.push(path);
      return files[path] ?? null;
    },
    reads,
  };
}

function manifest(slug: string, options: { includeCoherence?: boolean } = {}): string {
  const { includeCoherence = true } = options;
  return JSON.stringify({
    schemaVersion: 1,
    slug,
    artifacts: [
      { kind: 'plan', path: `.docs/plans/${slug}.md` },
      { kind: 'stories', path: `.docs/stories/${slug}.md` },
      ...(includeCoherence ? [{ kind: 'coherence', path: `.docs/coherence/${slug}.md` }] : []),
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

function artifactsWithout(slug: string, path: string): Record<string, string> {
  return Object.fromEntries(Object.entries(artifacts(slug)).filter(([candidate]) => candidate !== path));
}

describe('daemon backlog manifest discovery', () => {
  it('discovers a manifest-backed feature at the standard artifact paths and reads every listed discovery artifact', async () => {
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

  it('discovers a manifest-backed feature from non-legacy artifact paths', async () => {
    const paths = {
      plan: '.docs/f/decide/implementation-plan.md',
      stories: '.docs/f/decide/accepted-stories.md',
      coherence: '.docs/f/validation/coherence.md',
      complexity: '.docs/f/metadata/complexity.md',
      track: '.docs/f/metadata/track.md',
      intake: '.docs/f/metadata/intake.md',
    };
    const source = tree({
      '.docs/f/manifest.json': JSON.stringify({
        schemaVersion: 1,
        slug: 'f',
        artifacts: Object.entries(paths).map(([kind, path]) => ({ kind, path })),
      }),
      [paths.plan]: PLAN,
      [paths.stories]: STORIES,
      [paths.coherence]: COHERENCE,
      [paths.complexity]: 'Tier: M\n',
      [paths.track]: 'Track: technical\n',
      [paths.intake]: 'Source-Ref: acme/project#7\n',
    });

    const result = await discoverBacklog('/unused', undefined, undefined, { treeSource: source });

    expect(result.items).toEqual([expect.objectContaining({
      slug: 'f',
      planPath: paths.plan,
      storiesPath: paths.stories,
    })]);
    expect(source.reads).toEqual(expect.arrayContaining([
      '.docs/f/manifest.json',
      ...Object.values(paths),
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

  it('blocks a malformed manifest while another manifest-backed feature remains eligible', async () => {
    const source = tree({
      '.docs/f/manifest.json': '{ not json',
      '.docs/good/manifest.json': manifest('good'),
      ...artifacts('good'),
    });

    const result = await discoverBacklog('/unused', undefined, undefined, { treeSource: source });

    expect(result.items.map((item) => item.slug)).toEqual(['good']);
    expect(result.blocked).toEqual([expect.objectContaining({
      slug: 'f',
      reason: 'malformed-manifest',
      remedy: expect.stringContaining('.docs/f/manifest.json'),
    })]);
  });

  it('deduplicates malformed manifests before parsing them', async () => {
    const source = tree({
      '.docs/processed/manifest.json': '{ not json',
      '.docs/shipped/manifest.json': '{ not json',
      '.docs/parked/manifest.json': '{ not json',
      '.docs/good/manifest.json': manifest('good'),
      ...artifacts('good'),
      '.docs/shipped/shipped.md': renderShippedRecord({ slug: 'shipped', specHash: 'fixture' }),
    });

    const result = await discoverBacklog('/unused', async (slug) => slug === 'processed', undefined, {
      treeSource: source,
      isOperatorParked: async (slug) => slug === 'parked',
    });

    expect(result.items.map((item) => item.slug)).toEqual(['good']);
    expect(result.blocked).toEqual([]);
    expect(source.reads).not.toEqual(expect.arrayContaining([
      '.docs/processed/manifest.json',
      '.docs/shipped/manifest.json',
      '.docs/parked/manifest.json',
    ]));
  });

  it('blocks manifest-backed and legacy tier M candidates missing coherence', async () => {
    const source = tree({
      '.docs/manifest-missing/manifest.json': manifest('manifest-missing', { includeCoherence: false }),
      ...artifactsWithout('manifest-missing', '.docs/coherence/manifest-missing.md'),
      ...artifactsWithout('legacy-missing', '.docs/coherence/legacy-missing.md'),
    });

    const result = await discoverBacklog('/unused', undefined, undefined, { treeSource: source });

    expect(result.items).toEqual([]);
    expect(result.blocked).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: 'manifest-missing', reason: 'missing-coherence' }),
      expect.objectContaining({ slug: 'legacy-missing', reason: 'missing-coherence' }),
    ]));
  });

  it('silently skips a manifest candidate whose listed plan is absent', async () => {
    const slug = 'abandoned';
    const logs: string[] = [];
    const source = tree({
      [`.docs/${slug}/manifest.json`]: manifest(slug),
      ...artifactsWithout(slug, `.docs/plans/${slug}.md`),
    });

    const result = await discoverBacklog('/unused', undefined, (line) => logs.push(line), {
      treeSource: source,
      writeBlockedSnapshot: async () => {},
    });
    const reported = [
      ...result.items.map((item) => item.slug),
      ...result.blocked.map((item) => item.slug),
      ...result.gated.flatMap((item) => 'slug' in item ? [item.slug] : []),
    ];

    expect(reported).not.toContain(slug);
    expect(logs).toEqual([]);
  });

  // Covers: task:rem-prd-audit-15-r1
  it('preserves the frozen legacy discovery output and warning log', async () => {
    const source = tree({
      ...artifacts('x'),
      ...artifacts('x-y'),
      ...artifactsWithout('x-w-blocked', '.docs/stories/x-w-blocked.md'),
      ...artifacts('x-z-gated'),
    });
    const logs: string[] = [];

    const result = await discoverBacklog('/unused', undefined, (line) => logs.push(line), {
      treeSource: source,
      writeBlockedSnapshot: async () => {},
      daemonOwner: { resolved: true, id: 'alice' },
      readStamp: async (slug) => slug === 'x-z-gated'
        ? { present: true as const, id: 'bob' }
        : { present: true as const, id: 'alice' },
    });

    expect({ result, logs }).toEqual({
      result: {
        items: ['x-y', 'x'].map((slug) => ({
          slug,
          planPath: `.docs/plans/${slug}.md`,
          storiesPath: `.docs/stories/${slug}.md`,
          tier: 'M',
          track: 'technical',
          sourceRef: 'acme/project#7',
          applicabilityDeclarations: [],
          applicabilityBaseContentSha256: 'sha256:a2edc98ee2fb7a91184812601544af9707a272cde550581f36d9bd933e7b0140',
          applicabilityIgnored: { cause: 'toggle-off', steps: ['manual_test'] },
        })),
        waiting: [],
        blocked: [{
          slug: 'x-w-blocked',
          reason: 'stories-missing',
          remedy: 'Create the Stories file at .docs/stories/x-w-blocked.md on the default branch, or fix its reference in .docs/plans/x-w-blocked.md.',
        }],
        gated: [{
          kind: 'spec',
          slug: 'x-z-gated',
          reason: 'other-owner',
          otherOwner: 'bob',
          remedy: 'declare an Owner: alice or the daemon\'s own owner for this spec',
          sourceRef: 'acme/project#7',
        }],
      },
      logs: [
        'skip x-w-blocked: merged spec cannot build — Stories file missing at .docs/stories/x-w-blocked.md. Create the Stories file at .docs/stories/x-w-blocked.md on the default branch, or fix its reference in .docs/plans/x-w-blocked.md. logged once.',
        "skip x-z-gated: owner-gate — spec is owned by another operator ('bob'), not this daemon; logged once.",
      ],
    });
  });
});

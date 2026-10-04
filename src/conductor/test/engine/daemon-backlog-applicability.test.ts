import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { discoverBacklog, type BacklogTreeSource } from '../../src/engine/daemon-backlog.js';
import { deriveDaemonBaseState } from '../../src/engine/daemon-state.js';

const STORIES = '# Stories\n**Status:** Accepted\n';
const PLAN = (slug: string) => `# Plan\n**Stories:** .docs/stories/${slug}.md\n### Task 1\n**Dependencies:** none\n`;
const COHERENCE = '| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |\n|---|---|---|---|---|\n| story | S1 | Task 1 | covered | fixture |\n';

function tree(files: Record<string, string>, throwsFor?: string): BacklogTreeSource {
  return {
    listPlanFiles: async () => Object.keys(files).filter((path) => path.startsWith('.docs/plans/')).map((path) => path.slice('.docs/plans/'.length)),
    listShippedFiles: async () => [],
    listAdrFiles: async () => [],
    readFile: async (path) => {
      if (path === throwsFor) throw new Error('injected tree read failure');
      return files[path] ?? null;
    },
  };
}

function featureFiles(slug: string): Record<string, string> {
  return {
    [`.docs/plans/${slug}.md`]: PLAN(slug),
    [`.docs/stories/${slug}.md`]: STORIES,
    [`.docs/coherence/${slug}.md`]: COHERENCE,
  };
}

describe('daemon backlog applicability seeding', () => {
  it('carries a valid base declaration and seeds its content hash', async () => {
    const marker = 'Inapplicable: manual_test — no UI surface\n';
    const item = (await discoverBacklog('/unused', undefined, undefined, {
      treeSource: tree({ ...featureFiles('feature-a'), '.docs/applicability/feature-a.md': marker }),
      featureApplicabilityEnabled: true,
      resolveMarkerDecider: vi.fn(async () => ({ author: 'Operator <op@example.com>', committer: 'Bot <bot@example.com>', commit: 'base-sha' })),
    })).items[0];

    expect(item.applicabilityDeclarations).toEqual([{
      step: 'manual_test', reason: 'no UI surface', decider: { author: 'Operator <op@example.com>', committer: 'Bot <bot@example.com>' }, commit: 'base-sha',
    }]);
    const state = deriveDaemonBaseState({}, item, () => ({}));
    expect(state.applicability_declarations).toEqual(item.applicabilityDeclarations);
    expect(state.applicability_base_content_sha256).toBe(`sha256:${createHash('sha256').update(marker, 'utf8').digest('hex')}`);
  });

  it('seeds an empty list for another feature without a matching undated marker', async () => {
    const result = await discoverBacklog('/unused', undefined, undefined, {
      treeSource: tree({ ...featureFiles('2026-10-03-feature-a'), ...featureFiles('2026-10-03-feature-b'), '.docs/applicability/feature-a.md': 'Inapplicable: manual_test — reason\n' }),
      featureApplicabilityEnabled: true,
      resolveMarkerDecider: vi.fn(async () => ({ decider: 'unknown' as const })),
    });
    expect(result.items.find((item) => item.slug === '2026-10-03-feature-b')?.applicabilityDeclarations).toEqual([]);
  });

  it('refuses an ambiguous undated marker lookup and logs it', async () => {
    const logs: string[] = [];
    const result = await discoverBacklog('/unused', undefined, (line) => logs.push(line), {
      treeSource: tree({ ...featureFiles('2026-10-03-feature'), ...featureFiles('2026-10-04-feature'), '.docs/applicability/feature.md': 'Inapplicable: manual_test — reason\n' }),
      featureApplicabilityEnabled: true,
    });
    expect(result.items.every((item) => item.applicabilityDeclarations?.length === 0)).toBe(true);
    expect(logs.some((line) => line.includes('undated fallback refused') && line.includes('applicability'))).toBe(true);
  });

  it('retains an invalid base marker as ignored with the typed detail', async () => {
    const item = (await discoverBacklog('/unused', undefined, undefined, {
      treeSource: tree({ ...featureFiles('invalid'), '.docs/applicability/invalid.md': 'Inapplicable: prd_audit — must run\n' }),
      featureApplicabilityEnabled: true,
    })).items[0];
    expect(item.applicabilityDeclarations).toEqual([]);
    expect(item.applicabilityIgnored).toEqual({ cause: 'invalid', detail: { kind: 'not-declarable', line: 1, step: 'prd_audit' } });
  });

  it('logs a marker read failure and continues scanning', async () => {
    const logs: string[] = [];
    const result = await discoverBacklog('/unused', undefined, (line) => logs.push(line), {
      treeSource: tree(featureFiles('read-failure'), '.docs/applicability/read-failure.md'),
      featureApplicabilityEnabled: true,
    });
    expect(result.items[0].applicabilityDeclarations).toEqual([]);
    expect(logs.join('\n')).toContain('.docs/applicability/read-failure.md');
  });

  it('retains a disabled marker as toggle-off', async () => {
    const item = (await discoverBacklog('/unused', undefined, undefined, {
      treeSource: tree({ ...featureFiles('disabled'), '.docs/applicability/disabled.md': 'Inapplicable: manual_test — reason\n' }),
      featureApplicabilityEnabled: false,
    })).items[0];
    expect(item.applicabilityDeclarations).toEqual([]);
    expect(item.applicabilityIgnored).toEqual({ cause: 'toggle-off', steps: ['manual_test'] });
  });
});

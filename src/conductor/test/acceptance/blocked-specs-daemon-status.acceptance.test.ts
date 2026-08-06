import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  discoverBacklog,
  type BacklogTreeSource,
} from '../../src/engine/daemon-backlog.js';
import { runDaemonStatus } from '../../src/engine/daemon-observe-cli.js';
import type { ProjectRecord } from '../../src/engine/registry.js';

// Covers: FR-10, FR-11, FR-12, FR-13
//
// Story 4 crosses the real discovery boundary, the on-disk blocked snapshot,
// and the real daemon-status renderer. Local files are the controlled internal
// infrastructure; no Git, GitHub, provider, process, or network adapter is used.

interface BlockedEntry {
  slug: string;
  reason:
    | 'unresolvable-stories-ref'
    | 'stories-missing'
    | 'stories-not-approved'
    | 'no-dependency-tree'
    | 'missing-coherence';
  remedy: string;
}

interface DiscoveryWithBlocked {
  items: Array<{ slug: string }>;
  blocked: BlockedEntry[];
}

interface BlockedSnapshot {
  schemaVersion: 1;
  writtenAt: string;
  blocked: BlockedEntry[];
}

let roots: string[];

beforeEach(() => {
  roots = [];
});

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function freshRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function fsTreeSource(root: string): BacklogTreeSource {
  return {
    async listPlanFiles() {
      try {
        return (await readdir(join(root, '.docs/plans'))).filter((file) => file.endsWith('.md'));
      } catch {
        return [];
      }
    },
    async listShippedFiles() {
      try {
        return (await readdir(join(root, '.docs/shipped'))).filter((file) => file.endsWith('.md'));
      } catch {
        return [];
      }
    },
    async readFile(relativePath: string) {
      try {
        return await readFile(join(root, relativePath), 'utf-8');
      } catch {
        return null;
      }
    },
  };
}

function mapTreeSource(files: Map<string, string>): BacklogTreeSource {
  return {
    async listPlanFiles() {
      return [...files.keys()]
        .filter((file) => file.startsWith('.docs/plans/') && file.endsWith('.md'))
        .map((file) => file.slice('.docs/plans/'.length));
    },
    async listShippedFiles() {
      return [];
    },
    async readFile(relativePath: string) {
      return files.get(relativePath) ?? null;
    },
  };
}

const acceptedStories = '**Status:** Accepted\n\n# Stories\n';

function buildablePlan(storiesReference: string): string {
  return [
    '# Plan',
    `**Stories:** ${storiesReference}`,
    '',
    '### Task 1',
    '**Dependencies:** none',
    '',
  ].join('\n');
}

async function writePlan(root: string, slug: string, content: string): Promise<void> {
  await mkdir(join(root, '.docs/plans'), { recursive: true });
  await writeFile(join(root, `.docs/plans/${slug}.md`), content, 'utf-8');
  await mkdir(join(root, '.docs/complexity'), { recursive: true });
  await writeFile(join(root, `.docs/complexity/${slug}.md`), 'Tier: S\n', 'utf-8');
}

function record(name: string, path: string): ProjectRecord {
  return {
    schemaVersion: 1,
    name,
    path,
    status: 'active' as ProjectRecord['status'],
    registeredAt: '2026-08-05T12:00:00.000Z',
  };
}

async function writeRegistry(path: string, records: ProjectRecord[]): Promise<void> {
  await writeFile(path, JSON.stringify(records), 'utf-8');
}

async function writeBlockedSnapshot(repoRoot: string, body: unknown): Promise<void> {
  await mkdir(join(repoRoot, '.daemon'), { recursive: true });
  await writeFile(
    join(repoRoot, '.daemon/blocked.json'),
    typeof body === 'string' ? body : JSON.stringify(body),
    'utf-8',
  );
}

describe('blocked merged specs remain visible through daemon status (Covers: FR-10, FR-11, FR-12, FR-13)', () => {
  it('a discovery pass replaces the snapshot with every blocked entry and a written-at timestamp', async () => {
    const root = await freshRoot('blocked-specs-discovery-');
    await writePlan(root, 'unresolvable', buildablePlan('see the stories directory'));
    await writePlan(root, 'missing', buildablePlan('.docs/stories/missing.md'));
    await writeBlockedSnapshot(root, {
      schemaVersion: 1,
      writtenAt: '2026-08-05T10:00:00.000Z',
      blocked: [{ slug: 'stale', reason: 'stories-missing', remedy: 'old remedy' }],
    });

    const result = (await discoverBacklog(root, undefined, undefined, {
      treeSource: fsTreeSource(root),
    })) as unknown as DiscoveryWithBlocked;

    expect(result.blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: 'unresolvable', reason: 'unresolvable-stories-ref' }),
        expect.objectContaining({ slug: 'missing', reason: 'stories-missing' }),
      ]),
    );
    const snapshot = JSON.parse(
      await readFile(join(root, '.daemon/blocked.json'), 'utf-8'),
    ) as BlockedSnapshot;
    expect(snapshot.schemaVersion).toBe(1);
    expect(Date.parse(snapshot.writtenAt)).not.toBeNaN();
    expect(snapshot.blocked.map((entry) => entry.slug).sort()).toEqual(['missing', 'unresolvable']);
    expect(snapshot.blocked).not.toEqual(expect.arrayContaining([expect.objectContaining({ slug: 'stale' })]));
  });

  it('the next discovery pass clears a fixed spec from both the snapshot and daemon status without cleanup', async () => {
    const root = await freshRoot('blocked-specs-self-clear-');
    const registryRoot = await freshRoot('blocked-specs-registry-');
    const registryPath = join(registryRoot, 'registry.json');
    await writePlan(root, 'fixed-next-pass', buildablePlan('see the stories directory'));

    await discoverBacklog(root, undefined, undefined, { treeSource: fsTreeSource(root) });
    await mkdir(join(root, '.docs/stories'), { recursive: true });
    await writeFile(join(root, '.docs/stories/fixed-next-pass.md'), acceptedStories, 'utf-8');
    await writePlan(
      root,
      'fixed-next-pass',
      buildablePlan('.docs/stories/fixed-next-pass.md (now fixed)'),
    );
    await discoverBacklog(root, undefined, undefined, { treeSource: fsTreeSource(root) });
    await writeRegistry(registryPath, [record('fixture-repo', root)]);

    const lines: string[] = [];
    const { code } = await runDaemonStatus({
      registryPath,
      kill: () => true,
      clock: () => new Date('2026-08-05T12:10:00.000Z'),
      out: (line) => lines.push(line),
    });

    expect(code).toBe(0);
    const snapshot = JSON.parse(
      await readFile(join(root, '.daemon/blocked.json'), 'utf-8'),
    ) as BlockedSnapshot;
    expect(snapshot.blocked).toEqual([]);
    expect(lines.join('\n')).not.toContain('fixed-next-pass');
  });

  it('daemon status renders each blocked slug, reason, remedy, and snapshot age from an offline non-Git repo', async () => {
    const root = await freshRoot('blocked-specs-status-');
    const registryRoot = await freshRoot('blocked-specs-status-registry-');
    const registryPath = join(registryRoot, 'registry.json');
    await writeBlockedSnapshot(root, {
      schemaVersion: 1,
      writtenAt: '2026-08-05T12:00:00.000Z',
      blocked: [
        {
          slug: 'bad-reference',
          reason: 'unresolvable-stories-ref',
          remedy: 'fix .docs/plans/bad-reference.md using an accepted reference form',
        },
        {
          slug: 'missing-stories',
          reason: 'stories-missing',
          remedy: 'land .docs/stories/missing-stories.md on the default branch',
        },
      ],
    });
    await writeRegistry(registryPath, [record('offline-fixture', root)]);

    const lines: string[] = [];
    const { code } = await runDaemonStatus({
      registryPath,
      kill: () => true,
      clock: () => new Date('2026-08-05T12:03:00.000Z'),
      out: (line) => lines.push(line),
    });

    expect(code).toBe(0);
    const output = lines.join('\n');
    expect(output).toContain('bad-reference');
    expect(output).toContain('unresolvable-stories-ref');
    expect(output).toContain('fix .docs/plans/bad-reference.md');
    expect(output).toContain('missing-stories');
    expect(output).toContain('stories-missing');
    expect(output).toMatch(/as of 3m ago/i);
  });

  it('daemon status reports blocked state unknown when no discovery snapshot exists', async () => {
    const root = await freshRoot('blocked-specs-no-snapshot-');
    const registryRoot = await freshRoot('blocked-specs-no-snapshot-registry-');
    const registryPath = join(registryRoot, 'registry.json');
    await writeRegistry(registryPath, [record('never-scanned', root)]);

    const lines: string[] = [];
    const { code } = await runDaemonStatus({
      registryPath,
      kill: () => true,
      out: (line) => lines.push(line),
    });

    expect(code).toBe(0);
    expect(lines.join('\n').toLowerCase()).toContain('blocked state unknown');
  });

  it('daemon status treats an unparseable snapshot as unknown and still succeeds', async () => {
    const root = await freshRoot('blocked-specs-bad-snapshot-');
    const registryRoot = await freshRoot('blocked-specs-bad-snapshot-registry-');
    const registryPath = join(registryRoot, 'registry.json');
    await writeBlockedSnapshot(root, '{"schemaVersion":1,"writtenAt":"truncated');
    await writeRegistry(registryPath, [record('bad-snapshot', root)]);

    const lines: string[] = [];
    const { code } = await runDaemonStatus({
      registryPath,
      kill: () => true,
      out: (line) => lines.push(line),
    });

    expect(code).toBe(0);
    const output = lines.join('\n').toLowerCase();
    expect(output).toContain('blocked state unknown');
    expect(output).toContain('snapshot unreadable');
  });

  it('a blocked snapshot write failure is advisory: blocked results and eligible dispatch still return', async () => {
    const root = await freshRoot('blocked-specs-write-failure-');
    const files = new Map<string, string>([
      ['.docs/plans/blocked.md', buildablePlan('see the stories directory')],
      ['.docs/complexity/blocked.md', 'Tier: S\n'],
      ['.docs/plans/eligible.md', buildablePlan('.docs/stories/eligible.md')],
      ['.docs/complexity/eligible.md', 'Tier: S\n'],
      ['.docs/stories/eligible.md', acceptedStories],
    ]);

    const result = (await discoverBacklog(root, undefined, undefined, {
      treeSource: mapTreeSource(files),
      writeBlockedSnapshot: async () => {
        throw new Error('disk unavailable');
      },
    })) as unknown as DiscoveryWithBlocked;

    expect(result.blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: 'blocked', reason: 'unresolvable-stories-ref' }),
      ]),
    );
    expect(result.items.map((item) => item.slug)).toContain('eligible');
  });
});

// Covers: task:8
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemonOrderingReaders } from '../../src/engine/daemon-ordering-readers.js';
import { discoverBacklog, type BacklogTreeSource } from '../../src/engine/daemon-backlog.js';
import { localWorkSource, type LocalWorkSourceDeps } from '../../src/engine/daemon-work-source.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import type { GhRunner } from '../../src/engine/tracker-client.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'daemon-ordering-readers-'));
  roots.push(root);
  return root;
}

function fsTreeSource(root: string): BacklogTreeSource {
  const list = async (dir: string) => {
    try { return await readdir(join(root, dir)); } catch { return []; }
  };
  return {
    async listPlanFiles() { return (await list('.docs/plans')).filter((file) => file.endsWith('.md')); },
    async listShippedFiles() { return (await list('.docs/shipped')).filter((file) => file.endsWith('.md')); },
    async listAdrFiles() { return (await list('.docs/decisions')).filter((file) => /^adr-.*\.md$/i.test(file)); },
    async readFile(path) {
      try { return await readFile(join(root, path), 'utf8'); } catch { return null; }
    },
  };
}

async function seedPlan(root: string, slug: string, sourceRef: string): Promise<void> {
  await Promise.all(['.docs/plans', '.docs/stories', '.docs/coherence', '.docs/intake'].map(
    (dir) => mkdir(join(root, dir), { recursive: true }),
  ));
  await writeFile(join(root, `.docs/plans/${slug}.md`), '# Plan\n\n### Task 1\n**Dependencies:** none\n');
  await writeFile(join(root, `.docs/stories/${slug}.md`), '# Stories\n**Status:** Accepted\n');
  await writeFile(join(root, `.docs/coherence/${slug}.md`), '| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |\n|---|---|---|---|---|\n| story | S1 | Task 1 | covered | fixture |\n');
  await writeFile(join(root, `.docs/intake/${slug}.md`), `Source-Ref: ${sourceRef}\n`);
}

describe('createDaemonOrderingReaders', () => {
  it('shares unavailable-backend reporting across fresh scan resolvers while preserving pass-local blocker memos', async () => {
    const root = await fixtureRoot();
    await Promise.all([
      seedPlan(root, 'jira', 'PROJ-123'),
      seedPlan(root, 'high', 'acme/app#1'),
      seedPlan(root, 'unlabeled', 'acme/app#2'),
      seedPlan(root, 'boom', 'acme/app#3'),
    ]);
    const calls: string[][] = [];
    const run: GhRunner = async (args) => {
      calls.push(args);
      const endpoint = args.find((arg) => arg.startsWith('repos/')) ?? '';
      if (endpoint.includes('acme/app/issues/3/dependencies/blocked_by')) throw new Error('boom');
      if (endpoint.endsWith('/issues/1')) return { stdout: JSON.stringify({ labels: [{ name: 'priority: high' }] }) };
      if (endpoint.endsWith('/issues/2')) return { stdout: JSON.stringify({ labels: [] }) };
      return { stdout: '[]' };
    };
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline/events.jsonl'), events);
    const logs: string[] = [];
    persister.start();
    try {
      const readers = createDaemonOrderingReaders({ run, cwd: root, events, log: (line) => logs.push(line) });
      expect(readers.makeResolver()).not.toBe(readers.makeResolver());
      const workSource = localWorkSource({
        projectRoot: root,
        baseBranch: 'main',
        log: (line) => logs.push(line),
        isProcessed: async () => false,
        hasWarned: async () => false,
        markWarned: async () => {},
        fastForwardRoot: async () => {},
        discoverBacklog: (dir, isProcessed, log, options) => discoverBacklog(
          dir, isProcessed, log, { ...options, treeSource: fsTreeSource(dir) },
        ),
        priorityResolver: readers.priorityResolver,
        makeResolver: readers.makeResolver,
      } satisfies LocalWorkSourceDeps);

      const passes = await Promise.all([false, false, false].map((refresh) => workSource.discover({ refresh })));

      for (const items of passes) {
        expect(items.map((item) => item.slug)).toEqual(['high', 'unlabeled']);
        expect(items.map((item) => item.resolutionMode)).toEqual(['banded', 'banded']);
      }
      expect(logs.join('\n')).toContain('jira');
      expect(logs.join('\n')).toContain('no ordering adapter for jira reference PROJ-123');
      expect(logs.join('\n')).toContain('boom');
      expect(calls.flat()).not.toContain('PROJ-123');
      expect(calls.filter((args) => args.some((arg) => arg.includes('issues/3/dependencies/blocked_by')))).toHaveLength(3);
      const persisted = (await readFile(join(root, '.pipeline/events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line));
      expect(persisted.filter((event) => event.type === 'tracker_backend_unavailable')).toEqual([
        expect.objectContaining({ project: 'PROJ-123', backend: 'jira', reason: 'no-adapter' }),
      ]);
    } finally {
      persister.stop();
    }
  });
});

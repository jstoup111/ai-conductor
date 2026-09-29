// Covers: task:6, task:7, task:8, task:9, task:10

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createIntakeBackendComposite,
  type IntakeEventEmitter,
} from '../../src/engine/intake-backend-composite.js';
import { createLedger } from '../../src/engine/engineer/intake/ledger.js';
import { createGithubIssuesAdapter } from '../../src/engine/engineer/intake/github-issues.js';
import { reportDone, reportRouted } from '../../src/engine/engineer/intake/writeback.js';
import type { ProjectRecord, RegistryReader } from '../../src/engine/registry.js';
import type { GhRunner } from '../../src/engine/tracker-client.js';
import type { TrackerSelectionResult } from '../../src/engine/tracker-selection.js';

function project(name: string, path = `/projects/${name}`): ProjectRecord {
  return {
    schemaVersion: 1,
    name,
    path,
    remote: `git@github.com:${name}.git`,
    status: 'registered',
    registeredAt: '2026-09-28T00:00:00.000Z',
  };
}

function scriptedGh(calls: string[][]): GhRunner {
  return async (argv) => {
    calls.push(argv);
    return {
      stdout: JSON.stringify([{
        number: 17,
        title: 'An assigned issue',
        body: 'Poll this GitHub project.',
        labels: [],
      }]),
    };
  };
}

function registry(projects: ProjectRecord[]): RegistryReader {
  return {
    listProjects: async () => projects,
    getProject: async (path) => projects.find((candidate) => candidate.path === path),
  };
}

function resolver(selections: Map<string, TrackerSelectionResult>) {
  return async (projectPath: string) => selections.get(projectPath)
    ?? { ok: true as const, selection: { backend: 'github' as const } };
}

function recordingEmitter(events: unknown[]): IntakeEventEmitter {
  return { emit: async (event) => { events.push(event); } };
}

function createComposite(args: {
  projects: ProjectRecord[];
  selections: Map<string, TrackerSelectionResult>;
  calls: string[][];
  events: unknown[];
  ledgerPath: string;
  gh?: GhRunner;
  logs?: string[];
  resolveActor?: () => Promise<{ resolved: true; id: string }>;
  resolveTrackerSelection?: (projectPath: string) => Promise<TrackerSelectionResult>;
}) {
  return createIntakeBackendComposite({
    backendFactories: { github: createGithubIssuesAdapter },
    resolveTrackerSelection: args.resolveTrackerSelection ?? resolver(args.selections),
    registry: registry(args.projects),
    ledger: createLedger(args.ledgerPath),
    gh: args.gh ?? scriptedGh(args.calls),
    log: (message) => { args.logs?.push(message); },
    events: recordingEmitter(args.events),
    resolveActor: args.resolveActor,
  });
}

function writebackGh(calls: string[][]): GhRunner {
  return async (argv) => {
    calls.push(argv);
    if (argv[0] === 'issue' && argv[1] === 'view') {
      return { stdout: JSON.stringify({ assignees: [{ login: 'operator' }] }) };
    }
    return { stdout: '' };
  };
}

async function writebackParity(args: {
  port: ReturnType<typeof createGithubIssuesAdapter>;
  ledgerPath: string;
  sourceRef: string;
  status: 'routed' | 'done';
}) {
  const ledger = createLedger(args.ledgerPath);
  await ledger.record({ source: 'github-issues', sourceRef: args.sourceRef });
  const target = { source: 'github-issues', sourceRef: args.sourceRef, port: args.port, ledger };
  if (args.status === 'routed') {
    await reportRouted(target, 'owner/target');
  } else {
    await reportDone(target, 'https://github.com/owner/repo/pull/99', 'spec/task-9');
  }
  return ledger.list();
}

function ledgerEffects(entries: Awaited<ReturnType<typeof writebackParity>>) {
  return entries.map(({ capturedAt: _capturedAt, lastSeenAt: _lastSeenAt, ...entry }) => entry);
}

describe('intake backend composite tracker exclusion (Task 6)', () => {
  it('polls only GitHub projects and reports a Jira project without an adapter', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR!, 'intake-backend-composite-'));
    try {
      const projectA = project('owner/project-a');
      const projectB = project('owner/project-b');
      projectA.path = join(root, 'project-a');
      projectB.path = join(root, 'project-b');
      await Promise.all([mkdir(projectA.path), mkdir(projectB.path)]);
      const calls: string[][] = [];
      const events: unknown[] = [];
      const composite = createComposite({
        projects: [projectA, projectB],
        selections: new Map([[projectB.path, { ok: true, selection: { backend: 'jira' } }]]),
        calls,
        events,
        ledgerPath: join(root, 'ledger.json'),
      });

      const envelopes = await composite.poll();

      expect({
        sourceRefs: envelopes.map(({ sourceRef }) => sourceRef),
        calls,
        events,
      }).toEqual({
        sourceRefs: ['owner/project-a#17'],
        calls: [expect.arrayContaining(['-R', 'owner/project-a'])],
        events: [{
          type: 'tracker_backend_unavailable',
          project: 'owner/project-b',
          backend: 'jira',
          reason: 'no-adapter',
        }],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('excludes projects with invalid tracker configuration and reports each one', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR!, 'intake-backend-composite-'));
    try {
      const projectA = project('owner/project-a');
      const unreadableProject = project('owner/unparseable-config');
      const invalidBackendProject = project('owner/gitlab-config');
      projectA.path = join(root, 'project-a');
      unreadableProject.path = join(root, 'unparseable-config');
      invalidBackendProject.path = join(root, 'gitlab-config');
      await Promise.all([
        mkdir(projectA.path),
        mkdir(unreadableProject.path),
        mkdir(invalidBackendProject.path),
      ]);
      const calls: string[][] = [];
      const events: unknown[] = [];
      const composite = createComposite({
        projects: [projectA, unreadableProject, invalidBackendProject],
        selections: new Map([
          [unreadableProject.path, {
            ok: false,
            reason: 'invalid-config',
            detail: 'Failed to parse tracker configuration',
          }],
          [invalidBackendProject.path, {
            ok: false,
            reason: 'invalid-config',
            detail: 'tracker.backend must be github or jira',
          }],
        ]),
        calls,
        events,
        ledgerPath: join(root, 'ledger.json'),
      });

      const envelopes = await composite.poll();

      expect({
        sourceRefs: envelopes.map(({ sourceRef }) => sourceRef),
        calls,
        events,
      }).toEqual({
        sourceRefs: ['owner/project-a#17'],
        calls: [expect.arrayContaining(['-R', 'owner/project-a'])],
        events: [
          {
            type: 'tracker_backend_unavailable',
            project: 'owner/unparseable-config',
            backend: 'github',
            reason: 'invalid-config',
          },
          {
            type: 'tracker_backend_unavailable',
            project: 'owner/gitlab-config',
            backend: 'github',
            reason: 'invalid-config',
          },
        ],
      });
      expect(calls.flat()).not.toContain('owner/unparseable-config');
      expect(calls.flat()).not.toContain('owner/gitlab-config');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns no envelopes and reports every Jira project when no adapter exists', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR!, 'intake-backend-composite-'));
    try {
      const projectA = project('owner/project-a');
      const projectB = project('owner/project-b');
      projectA.path = join(root, 'project-a');
      projectB.path = join(root, 'project-b');
      await Promise.all([mkdir(projectA.path), mkdir(projectB.path)]);
      const calls: string[][] = [];
      const events: unknown[] = [];
      const composite = createComposite({
        projects: [projectA, projectB],
        selections: new Map([
          [projectA.path, { ok: true, selection: { backend: 'jira' } }],
          [projectB.path, { ok: true, selection: { backend: 'jira' } }],
        ]),
        calls,
        events,
        ledgerPath: join(root, 'ledger.json'),
      });

      await expect(composite.poll()).resolves.toEqual([]);
      expect({ calls, events }).toEqual({
        calls: [],
        events: [
          { type: 'tracker_backend_unavailable', project: 'owner/project-a', backend: 'jira', reason: 'no-adapter' },
          { type: 'tracker_backend_unavailable', project: 'owner/project-b', backend: 'jira', reason: 'no-adapter' },
        ],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('intake backend composite tracker exclusion episodes (Task 8)', () => {
  it('emits once per unavailable-backend episode and re-emits after the project becomes available', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR!, 'intake-backend-composite-'));
    try {
      const projectA = project('owner/project-a', join(root, 'project-a'));
      const projectB = project('owner/project-b', join(root, 'project-b'));
      await Promise.all([mkdir(projectA.path), mkdir(projectB.path)]);
      const calls: string[][] = [];
      const events: unknown[] = [];
      const selections = new Map<string, TrackerSelectionResult>([
        [projectB.path, { ok: true, selection: { backend: 'jira' } }],
      ]);
      const composite = createComposite({
        projects: [projectA, projectB],
        selections,
        calls,
        events,
        ledgerPath: join(root, 'ledger.json'),
      });

      await composite.poll();
      await composite.poll();
      selections.set(projectB.path, { ok: true, selection: { backend: 'github' } });
      await composite.poll();
      selections.set(projectB.path, { ok: true, selection: { backend: 'jira' } });
      await composite.poll();

      expect(events).toEqual([
        { type: 'tracker_backend_unavailable', project: 'owner/project-b', backend: 'jira', reason: 'no-adapter' },
        { type: 'tracker_backend_unavailable', project: 'owner/project-b', backend: 'jira', reason: 'no-adapter' },
      ]);
      expect(calls.filter((argv) => argv.includes('owner/project-b'))).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('emits exclusions before preserving the GitHub adapter poll-failure path', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR!, 'intake-backend-composite-'));
    try {
      const projectA = project('owner/project-a', join(root, 'project-a'));
      const projectB = project('owner/project-b', join(root, 'project-b'));
      await Promise.all([mkdir(projectA.path), mkdir(projectB.path)]);
      const calls: string[][] = [];
      const events: unknown[] = [];
      const logs: string[] = [];
      const gh: GhRunner = async (argv) => {
        calls.push(argv);
        if (argv.includes('owner/project-a')) throw new Error('scripted GitHub failure');
        return { stdout: '[]' };
      };
      const composite = createComposite({
        projects: [projectA, projectB],
        selections: new Map([[projectB.path, { ok: true, selection: { backend: 'jira' } }]]),
        calls,
        events,
        ledgerPath: join(root, 'ledger.json'),
        gh,
        logs,
      });

      await expect(composite.poll()).resolves.toEqual([]);

      expect(events).toEqual([
        { type: 'tracker_backend_unavailable', project: 'owner/project-b', backend: 'jira', reason: 'no-adapter' },
      ]);
      expect(logs).toEqual([
        expect.stringContaining('github-issues: poll failed for owner/project-a'),
      ]);
      expect(logs[0]).toContain('scripted GitHub failure');
      expect(calls).toEqual([expect.arrayContaining(['-R', 'owner/project-a'])]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('intake backend composite write-back routing (Task 9)', () => {
  it.each([
    ['routed' as const, 'owner/repo#12'],
    ['done' as const, 'owner/repo#12'],
    ['routed' as const, 'owner/unregistered#12'],
  ])('preserves GitHub write-back argv and ledger effects for %s %s', async (status, sourceRef) => {
    const root = await mkdtemp(join(process.env.TMPDIR!, 'intake-backend-composite-'));
    try {
      const registered = project('owner/repo', join(root, 'repo'));
      await mkdir(registered.path);
      const directCalls: string[][] = [];
      const compositeCalls: string[][] = [];
      const selectionCalls: string[] = [];
      const resolveActor = async () => ({ resolved: true as const, id: 'operator' });
      const direct = createGithubIssuesAdapter({
        gh: writebackGh(directCalls),
        registry: { list: async () => [{ name: registered.name, path: registered.path }] },
        ledger: createLedger(join(root, 'direct-adapter.json')),
        resolveActor,
      });
      const composite = createComposite({
        projects: [registered],
        selections: new Map(),
        calls: compositeCalls,
        events: [],
        ledgerPath: join(root, 'composite-adapter.json'),
        gh: writebackGh(compositeCalls),
        resolveActor,
        resolveTrackerSelection: async (projectPath) => {
          selectionCalls.push(projectPath);
          return { ok: true, selection: { backend: 'github' } };
        },
      });

      const directLedger = await writebackParity({
        port: direct,
        ledgerPath: join(root, 'direct-ledger.json'),
        sourceRef,
        status,
      });
      const compositeLedger = await writebackParity({
        port: composite,
        ledgerPath: join(root, 'composite-ledger.json'),
        sourceRef,
        status,
      });

      expect({ calls: compositeCalls, ledger: ledgerEffects(compositeLedger) }).toEqual({
        calls: directCalls,
        ledger: ledgerEffects(directLedger),
      });
      // The adapter resolves its report cwd through the composite registry;
      // an owned ref also requires the composite's routing resolution.
      expect(selectionCalls).toEqual(sourceRef === 'owner/repo#12'
        ? [registered.path, registered.path]
        : [registered.path]);
      expect(compositeCalls).toContainEqual(expect.arrayContaining(['issue', 'comment', '12', '-R', sourceRef.split('#')[0]]));
      if (status === 'done') {
        expect(compositeCalls).toContainEqual(expect.arrayContaining(['api', '--method', 'POST', 'repos/owner/repo/issues/12/labels', '-f', 'labels[]=engineer:handled']));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('intake backend composite unavailable write-backs (Task 10)', () => {
  it.each([
    ['routed' as const, 'ENG-42', undefined],
    ['done' as const, 'owner/jira-project#42', 'owner/jira-project'],
  ])('skips %s write-back for %s while advancing the ledger', async (status, sourceRef, jiraProject) => {
    const root = await mkdtemp(join(process.env.TMPDIR!, 'intake-backend-composite-'));
    try {
      const registered = jiraProject ? project(jiraProject, join(root, 'jira-project')) : undefined;
      if (registered) await mkdir(registered.path);
      const calls: string[][] = [];
      const events: unknown[] = [];
      const composite = createComposite({
        projects: registered ? [registered] : [],
        selections: registered
          ? new Map([[registered.path, { ok: true, selection: { backend: 'jira' } }]])
          : new Map(),
        calls,
        events,
        ledgerPath: join(root, 'adapter.json'),
        gh: writebackGh(calls),
        resolveActor: async () => ({ resolved: true as const, id: 'operator' }),
      });
      const ledgerPath = join(root, 'ledger.json');
      const entries = await writebackParity({ port: composite, ledgerPath, sourceRef, status });

      expect(calls).toEqual([]);
      expect(events).toEqual([
        {
          type: 'tracker_backend_unavailable',
          project: registered?.name ?? sourceRef,
          backend: 'jira',
          reason: 'no-adapter',
        },
      ]);
      expect(ledgerEffects(entries)).toEqual([
        expect.objectContaining({
          sourceRef,
          status,
          ...(status === 'done'
            ? { prUrl: 'https://github.com/owner/repo/pull/99', branch: 'spec/task-9' }
            : {}),
        }),
      ]);
      expect(entries[0]?.writebackPending).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

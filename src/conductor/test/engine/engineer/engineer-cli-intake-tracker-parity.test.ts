// Covers: task:5
// Regression parity at the intake composition boundary. Existing projects that
// have no tracker config must continue through the GitHub adapter unchanged.

import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildIntake } from '../../../src/engine/engineer-cli.js';
import { createRegistryReader } from '../../../src/engine/registry.js';
import { createLedger } from '../../../src/engine/engineer/intake/ledger.js';
import { createGithubIssuesAdapter, type GhRunner } from '../../../src/engine/engineer/intake/github-issues.js';
import type { GithubOperationEventEmitter } from '../../../src/engine/github-operations.js';
import { resolveTrackerSelection } from '../../../src/engine/tracker-selection.js';

function scriptedGh(calls: string[][]): GhRunner {
  return async (argv) => {
    calls.push(argv);
    if (argv[0] === 'issue' && argv[1] === 'list') {
      return {
        stdout: JSON.stringify([{
          number: 17,
          title: 'Keep legacy GitHub intake',
          body: 'Existing projects need no tracker migration.',
          labels: [],
        }]),
      };
    }
    return { stdout: '' };
  };
}

/** Pre-composite registry mapping from engineer-cli.ts. */
function parseGhRepo(remote: string): string | null {
  const match = remote.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  return match ? match[1] : null;
}

function stableLedger(entries: Awaited<ReturnType<ReturnType<typeof createLedger>['list']>>) {
  return entries.map(({ capturedAt: _capturedAt, lastSeenAt: _lastSeenAt, ...entry }) => entry);
}

describe('buildIntake tracker-aware composition (Task 5)', () => {
  it('preserves GitHub poll parity for every legacy-or-GitHub tracker shape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'intake-tracker-parity-'));
    try {
      const registryPath = join(root, 'registry.json');
      const projects = [
        { name: 'acme/no-config-file', config: undefined },
        { name: 'acme/no-tracker-key', config: 'model: codex\n' },
        { name: 'acme/invalid-unrelated-key', config: 'not_a_real_key: ignored-by-tracker-selection\n' },
        { name: 'acme/explicit-github', config: 'tracker:\n  backend: github\n' },
      ].map((project) => ({ ...project, path: join(root, project.name.replace('/', '-')) }));
      await Promise.all(projects.map(async (project) => {
        await mkdir(project.path, { recursive: true });
        if (project.config !== undefined) {
          await mkdir(join(project.path, '.ai-conductor'), { recursive: true });
          await writeFile(join(project.path, '.ai-conductor', 'config.yml'), project.config, 'utf8');
        }
      }));
      await writeFile(registryPath, JSON.stringify(projects.map(({ name, path }) => ({
        schemaVersion: 1,
        name,
        path,
        remote: `git@github.com:${name}.git`,
        status: 'registered',
        registeredAt: '2026-09-28T00:00:00.000Z',
      }))), 'utf8');

      const selection = vi.fn(resolveTrackerSelection);
      const compositeCalls: string[][] = [];
      const referenceCalls: string[][] = [];
      const compositeEvents: unknown[] = [];
      const referenceEvents: unknown[] = [];
      const recordEvents = (events: unknown[]): GithubOperationEventEmitter => ({
        emit: async (event) => { events.push(event); },
      });
      const composite = buildIntake({
        engineerDir: join(root, 'composite'),
        registryPath,
        gh: scriptedGh(compositeCalls),
        printErr: () => {},
        resolveTrackerSelection: selection,
        events: recordEvents(compositeEvents),
      });
      const resolverCallsBeforePoll = selection.mock.calls.map(([path]) => path);
      const referenceReader = createRegistryReader({ registryPath });
      const referenceLedger = createLedger(join(root, 'reference', 'ledger.json'));
      const reference = createGithubIssuesAdapter({
        gh: scriptedGh(referenceCalls),
        registry: {
          list: async () => (await referenceReader.listProjects()).map((project) => ({
            name: project.remote ? parseGhRepo(project.remote) ?? project.name : project.name,
            ghRepo: project.remote ? parseGhRepo(project.remote) ?? undefined : undefined,
            path: project.path,
          })),
        },
        ledger: referenceLedger,
        events: recordEvents(referenceEvents),
      });

      const [actualEnvelopes, expectedEnvelopes] = await Promise.all([
        composite.adapter.poll(),
        reference.poll(),
      ]);

      expect({
        envelopes: actualEnvelopes.map(({ id: _id, receivedAt: _receivedAt, ...envelope }) => envelope),
        ledger: stableLedger(await composite.ledger.list()),
        ghArgv: compositeCalls,
        trackerEvents: compositeEvents,
        resolverCallsBeforePoll,
        resolverCalls: selection.mock.calls.map(([path]) => path),
      }).toEqual({
        envelopes: expectedEnvelopes.map(({ id: _id, receivedAt: _receivedAt, ...envelope }) => envelope),
        ledger: stableLedger(await referenceLedger.list()),
        ghArgv: referenceCalls,
        trackerEvents: referenceEvents,
        resolverCallsBeforePoll: [],
        resolverCalls: projects.map(({ path }) => path),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

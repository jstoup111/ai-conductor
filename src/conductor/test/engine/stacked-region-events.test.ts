// Covers: task:12
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Conductor } from '../../src/engine/conductor.js';
import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../src/engine/coverage-binding-envelope.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductorEvent } from '../../src/types/events.js';

const execFile = promisify(execFileCallback);
const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

let root: string;

async function git(args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd: root })).stdout;
}

async function persistedEvents(): Promise<ConductorEvent[]> {
  return (await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => {
      const { ts: _ts, ...event } = JSON.parse(line) as { ts: number } & ConductorEvent;
      return event as ConductorEvent;
    });
}

async function closeFirstChild(): Promise<void> {
  const tip = (await git(['rev-parse', 'HEAD'])).trim();
  await git(['branch', 'feat/c1/demo', tip]);
  await git(['update-ref', 'refs/conductor/demo/closed/c1', tip]);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'stacked-region-events-'));
  await git(['init', '-q', '-b', 'feat/daemon-demo']);
  await git(['config', 'user.email', 'events@example.test']);
  await git(['config', 'user.name', 'Events Test']);
  await writeFile(join(root, 'README.md'), 'base\n');
  await git(['add', 'README.md']);
  await git(['commit', '-qm', 'base']);
  await mkdir(join(root, '.ai-conductor'), { recursive: true });
  await writeFile(join(root, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 2\n');
  await git(['add', '.ai-conductor/config.yml']);
  await git(['commit', '-qm', 'configure stack']);
  await writeFile(join(root, '.git', 'info', 'exclude'), '.pipeline/\n');
  await writeCoverageBindingEnvelope(root, {
    version: 1, slug: 'demo', runId: 'events-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['first', 'leaf'] },
    // An empty, but present, ownership map keeps both children on the
    // no-owned-criteria fast path and lets this test observe both transitions.
    storyOwnership: {},
  }, envelopeFilesystem);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await writeFile(join(root, '.pipeline', 'conduct-state.json'), JSON.stringify({
    feature_desc: 'demo', plan: 'done', coverage_binding: 'done',
  }));
  for (const child of [1, 2]) {
    const childPipeline = join(root, '.pipeline', 'children', String(child));
    await mkdir(childPipeline, { recursive: true });
    await writeFile(join(childPipeline, 'conduct-state.json'), JSON.stringify({
      acceptance_specs: 'pending',
    }));
  }
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('stacked BUILD region events', () => {
  it('persists the active child on no-owned-criteria gate verdicts', async () => {
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await closeFirstChild();
      await new Conductor({
        projectRoot: root,
        stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
        featureSlug: 'demo',
        fromStep: 'acceptance_specs',
        events,
        verifyArtifacts: false,
        stepRunner: { run: async () => ({ success: true }) },
      }).run();

      const records = await persistedEvents();
      const childTwoVerdict = records.find((event) =>
        event.type === 'gate_verdict' && event.step === 'acceptance_specs' && event.child === 2,
      );
      expect(childTwoVerdict).toEqual(expect.objectContaining({ child: 2 }));
    } finally {
      persister.stop();
    }
  });

  it('persists the active child on dispatched region step starts', async () => {
    await writeCoverageBindingEnvelope(root, {
      version: 1, slug: 'demo', runId: 'events-2', status: 'done', entries: [],
      sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['first', 'leaf'] },
      storyOwnership: { S1: 1, S2: 2 },
    }, envelopeFilesystem);
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await closeFirstChild();
      await new Conductor({
        projectRoot: root,
        stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
        featureSlug: 'demo',
        fromStep: 'acceptance_specs',
        events,
        verifyArtifacts: false,
        stepRunner: { run: async () => ({ success: true }) },
      }).run();

      const starts = (await persistedEvents()).filter((event) =>
        event.type === 'step_started' && event.step === 'acceptance_specs',
      );
      expect(starts).toEqual([
        expect.objectContaining({ child: 2 }),
      ]);
    } finally {
      persister.stop();
    }
  });
});

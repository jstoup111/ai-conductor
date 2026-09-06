import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConductorEventEmitter } from '../src/ui/events.js';
import { CloseoutEventTail } from '../src/engine/closeout-tail.js';
import { EventPersister } from '../src/engine/event-persister.js';

const directories: string[] = [];

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, {
      recursive: true,
      force: true,
    })),
  );
});

async function createProjectRoot(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'closeout-tail-'));
  directories.push(projectRoot);
  return projectRoot;
}

describe('CloseoutEventTail', () => {
  it('treats an absent sibling ledger as no new events', async () => {
    const events = new ConductorEventEmitter();
    const received: unknown[] = [];
    events.on('pipeline_closeout', (event) => {
      received.push(event);
    });
    const tail = new CloseoutEventTail({ projectRoot: await createProjectRoot(), events });

    await tail.poll();

    expect(received).toEqual([]);
  });

  it('emits complete lines once and retains a partial trailing record until it ends in a newline', async () => {
    const projectRoot = await createProjectRoot();
    const ledger = join(projectRoot, '.pipeline/pipeline-events.jsonl');
    const completed = {
      type: 'pipeline_closeout',
      obligation: 'evaluator',
      startedAt: 100,
      endedAt: 140,
      ts: 140,
    } as const;
    const partial = {
      type: 'pipeline_closeout',
      obligation: 'summary',
      startedAt: 150,
      endedAt: 180,
      ts: 180,
    } as const;
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(
      ledger,
      `${JSON.stringify(completed)}\n${JSON.stringify(partial)}`,
      { encoding: 'utf8', flush: true },
    );
    const events = new ConductorEventEmitter();
    const received: unknown[] = [];
    events.on('pipeline_closeout', (event) => {
      received.push(event);
    });
    const tail = new CloseoutEventTail({ projectRoot, events });

    await tail.poll();
    await tail.poll();

    expect(received).toEqual([completed]);

    await appendFile(ledger, '\n', 'utf8');

    await tail.poll();
    await tail.poll();

    expect(received).toEqual([completed, partial]);
  });
});

describe('CloseoutEventTail lifecycle', () => {
  it('polls at its configured interval after it starts', async () => {
    vi.useFakeTimers();
    try {
      const projectRoot = await createProjectRoot();
      const events = new ConductorEventEmitter();
      const tail = new CloseoutEventTail({ projectRoot, events });
      const poll = vi.spyOn(tail, 'poll').mockResolvedValue();

      tail.start();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(poll).toHaveBeenCalledOnce();

      tail.stop();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(poll).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('contains background read rejections and emits a poll-failed diagnostic', async () => {
    vi.useFakeTimers();
    try {
      const events = new ConductorEventEmitter();
      const diagnostics: unknown[] = [];
      events.on('pipeline_tail_diagnostic', (event) => { diagnostics.push(event); });
      const tail = new CloseoutEventTail({
        projectRoot: await createProjectRoot(),
        events,
        readLedger: vi.fn().mockRejectedValue(new Error('unavailable')),
      });

      tail.start();
      await vi.advanceTimersByTimeAsync(1_000);
      tail.stop();

      expect(diagnostics).toEqual([{
        type: 'pipeline_tail_diagnostic',
        reason: 'poll-failed',
        path: '.pipeline/pipeline-events.jsonl',
      }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-emits newly tailed closeout records to live bus subscribers exactly once', async () => {
    const projectRoot = await createProjectRoot();
    const ledger = join(projectRoot, '.pipeline/pipeline-events.jsonl');
    const closeout = {
      type: 'pipeline_closeout',
      obligation: 'evaluator',
      startedAt: 100,
      endedAt: 140,
      ts: 140,
    } as const;
    const events = new ConductorEventEmitter();
    const received: unknown[] = [];
    events.on('pipeline_closeout', (event) => {
      received.push(event);
    });
    const tail = new CloseoutEventTail({ projectRoot, events });

    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(ledger, `${JSON.stringify(closeout)}\n`, 'utf8');
    await tail.poll();
    await tail.poll();

    expect(received).toEqual([closeout]);
  });

  it('consumes malformed completed lines and reports their byte offset once', async () => {
    const projectRoot = await createProjectRoot();
    const ledger = join(projectRoot, '.pipeline/pipeline-events.jsonl');
    const first = {
      type: 'pipeline_closeout', obligation: 'evaluator', startedAt: 100, endedAt: 140, ts: 140, note: 'café',
    } as const;
    const second = {
      type: 'pipeline_closeout', obligation: 'summary', startedAt: 150, endedAt: 180, ts: 180,
    } as const;
    const malformed = '{not-json}';
    const partialMalformed = '{also-not-json}';
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(
      ledger,
      `${JSON.stringify(first)}\n\n${malformed}\n${JSON.stringify(second)}\n${partialMalformed}`,
      'utf8',
    );
    const events = new ConductorEventEmitter();
    const closeouts: unknown[] = [];
    const diagnostics: unknown[] = [];
    events.on('pipeline_closeout', (event) => { closeouts.push(event); });
    events.on('pipeline_tail_diagnostic', (event) => { diagnostics.push(event); });
    const tail = new CloseoutEventTail({ projectRoot, events });

    await tail.poll();
    await tail.poll();

    expect(closeouts).toEqual([first, second]);
    expect(diagnostics).toEqual([{
      type: 'pipeline_tail_diagnostic',
      reason: 'malformed-line',
      path: '.pipeline/pipeline-events.jsonl',
      byteOffset: Buffer.byteLength(`${JSON.stringify(first)}\n\n`, 'utf8'),
    }]);

    await appendFile(ledger, '\n', 'utf8');
    await tail.poll();

    expect(diagnostics).toEqual([
      {
        type: 'pipeline_tail_diagnostic',
        reason: 'malformed-line',
        path: '.pipeline/pipeline-events.jsonl',
        byteOffset: Buffer.byteLength(`${JSON.stringify(first)}\n\n`, 'utf8'),
      },
      {
        type: 'pipeline_tail_diagnostic',
        reason: 'malformed-line',
        path: '.pipeline/pipeline-events.jsonl',
        byteOffset: Buffer.byteLength(`${JSON.stringify(first)}\n\n${malformed}\n${JSON.stringify(second)}\n`, 'utf8'),
      },
    ]);
  });

  it('shares one in-flight traversal and releases it after a failed read', async () => {
    const read = deferred<Buffer>();
    const readLedger = vi.fn(() => read.promise);
    const events = new ConductorEventEmitter();
    const received: unknown[] = [];
    events.on('pipeline_closeout', (event) => { received.push(event); });
    const tail = new CloseoutEventTail({ projectRoot: await createProjectRoot(), events, readLedger });

    const first = tail.poll();
    const second = tail.poll();
    expect(second).toBe(first);
    expect(readLedger).toHaveBeenCalledOnce();

    read.reject(new Error('read failed'));
    await expect(first).rejects.toThrow('read failed');

    readLedger.mockResolvedValueOnce(Buffer.from(`${JSON.stringify({
      type: 'pipeline_closeout', obligation: 'summary', startedAt: 1, endedAt: 2, ts: 2,
    })}\n`));
    await tail.poll();

    expect(received).toHaveLength(1);
    expect(readLedger).toHaveBeenCalledTimes(2);
  });

  it('persists a malformed-line diagnostic once through the existing event spine', async () => {
    const projectRoot = await createProjectRoot();
    const pipelineDir = join(projectRoot, '.pipeline');
    const sourceLedger = join(pipelineDir, 'pipeline-events.jsonl');
    const eventLedger = join(pipelineDir, 'events.jsonl');
    await mkdir(pipelineDir, { recursive: true });
    await writeFile(sourceLedger, '{not-json}\n');
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(eventLedger, events);
    persister.start();
    const tail = new CloseoutEventTail({ projectRoot, events });

    await tail.poll();
    await tail.poll();
    persister.stop();

    const persisted = (await readFile(eventLedger, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      type: 'pipeline_tail_diagnostic', reason: 'malformed-line',
      path: '.pipeline/pipeline-events.jsonl', byteOffset: 0,
    });
  });
});

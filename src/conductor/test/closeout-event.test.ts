import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { appendCloseoutEvent } from '../src/engine/closeout-events.js';
import { CloseoutEventTail } from '../src/engine/closeout-tail.js';
import { readMergedFeatureEvents } from '../src/engine/build-tail-rollup.js';
import { ConductorEventEmitter } from '../src/ui/events.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

it('projects an externally written build-review disposition when a tail starts later', async () => {
  const root = await mkdtemp(join(tmpdir(), 'external-disposition-')); directories.push(root);
  const disposition = { type: 'build_review_disposition_accepted' as const, feature: 'feature', lapId: 'lap-1', findingId: 'finding-1', operator: 'operator', ts: '2026-10-01T00:00:00.000Z' };
  appendCloseoutEvent(root, disposition);
  const events = new ConductorEventEmitter(); const received: unknown[] = [];
  events.on('build_review_disposition_accepted', (event) => { received.push(event); });
  await new CloseoutEventTail({ projectRoot: root, events }).drain();
  expect(received).toEqual([disposition]);
});

it('merges a later-tailed disposition between bracketing engine events', async () => {
  const root = await mkdtemp(join(tmpdir(), 'external-disposition-')); directories.push(root);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await writeFile(join(root, '.pipeline/events.jsonl'), [
    { type: 'step_started', step: 'build', index: 1, ts: '2026-10-01T00:00:01.000Z' },
    { type: 'step_completed', step: 'build', status: 'done', ts: '2026-10-01T00:00:03.000Z' },
  ].map((event) => JSON.stringify(event)).join('\n'));
  const disposition = { type: 'build_review_disposition_accepted' as const, feature: 'feature', lapId: 'lap-1', findingId: 'finding-1', operator: 'operator', ts: '2026-10-01T00:00:02.000Z' };
  appendCloseoutEvent(root, disposition);
  await expect(readMergedFeatureEvents(root)).resolves.toEqual([
    expect.objectContaining({ type: 'step_started', ts: Date.parse('2026-10-01T00:00:01.000Z') }),
    expect.objectContaining({ type: 'build_review_disposition_accepted', ts: Date.parse(disposition.ts) }),
    expect.objectContaining({ type: 'step_completed', ts: Date.parse('2026-10-01T00:00:03.000Z') }),
  ]);
});

import { mkdtemp, mkdir, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { SessionEventReader } from '../../src/engine/session-event-reader.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<{ root: string; producer: string }> {
  const root = await mkdtemp(join(tmpdir(), 'session-event-reader-'));
  roots.push(root);
  const producer = join(root, '.pipeline', 'session-events', 'dispatch-1', 'producer-a.jsonl');
  await mkdir(join(root, '.pipeline', 'session-events', 'dispatch-1'), { recursive: true });
  return { root, producer };
}

const event = {
  type: 'session_command_refused', eventId: 'event-1', sourceTime: '2026-10-02T12:00:00.000Z',
  dispatchId: 'dispatch-1', provider: 'codex', scope: { kind: 'feature', featureSlug: 'feature-a' }, subcommand: 'finish-record',
} as const;

describe('SessionEventReader', () => {
  it('holds a partial UTF-8 JSONL record until its newline, then delivers it exactly once', async () => {
    const { root, producer } = await fixture();
    // An ignored UTF-8 field proves byte offsets never split an encoded code point.
    const expected = { ...event, note: 'café' };
    const record = JSON.stringify(expected);
    await writeFile(producer, record);
    const reader = new SessionEventReader({ projectRoot: root });

    expect(await reader.read()).toEqual([]);
    await appendFile(producer, '\n');
    const records = await reader.read();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: 'event', event: expected });
    reader.acknowledge(records[0]!);
    expect(await reader.read()).toEqual([]);
  });

  it('reports an incomplete record only when the producer is settled without exposing its contents', async () => {
    const { root, producer } = await fixture();
    await writeFile(producer, JSON.stringify(event));
    const reader = new SessionEventReader({ projectRoot: root });

    expect(await reader.read()).toEqual([]);
    expect(await reader.drain()).toEqual([expect.objectContaining({ kind: 'diagnostic', code: 'incomplete-record' })]);
  });

  it('diagnoses malformed, oversized, and invalid-attribution records while retaining a later valid record', async () => {
    const { root, producer } = await fixture();
    await writeFile(producer, [
      '{not-json}',
      JSON.stringify({ ...event, dispatchId: '../../escape' }),
      JSON.stringify({ ...event, eventId: 'event-large', subcommand: 'x'.repeat(5_000) }),
      JSON.stringify(event),
      '',
    ].join('\n'));
    const reader = new SessionEventReader({ projectRoot: root });

    const records = await reader.read();
    expect(records.map((record) => record.kind === 'diagnostic' ? record.code : record.event.eventId))
      .toEqual(['malformed-json', 'invalid-attribution', 'record-too-large', 'event-1']);
  });
});

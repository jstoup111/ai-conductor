import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { quarantineEngineerSignals, partitionSignalsContent } from '../../src/engine/engineer/quarantine.js';

// ───────────────────────────────────────────────────────────────────────────
// Specs for the T5 quarantine maintenance script's core logic
// (jstoup111/ai-conductor#861). Always operates over a scratch tmp dir — never
// the real operator store.
// ───────────────────────────────────────────────────────────────────────────

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), 'quarantine-engineer-signals-test-'));
});

afterEach(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

const REAL_LINE_1 = JSON.stringify({ schemaVersion: 1, project: 'ai-conductor', feature: 'foo', ts: '2026-01-01T00:00:00.000Z' });
const REAL_LINE_2 = JSON.stringify({ schemaVersion: 1, project: 'other-real-project', feature: 'bar', ts: '2026-01-02T00:00:00.000Z' });
const TEST_LINE_1 = JSON.stringify({ schemaVersion: 1, project: 'test-project', feature: 'baz', ts: '2026-01-03T00:00:00.000Z' });
const TEST_LINE_2 = JSON.stringify({ schemaVersion: 1, project: 'test-project', feature: 'qux', ts: '2026-01-04T00:00:00.000Z' });
const MALFORMED_LINE = '{not valid json at all';

describe('partitionSignalsContent', () => {
  it('keeps real and malformed lines, quarantines only test-project lines, preserving order and bytes', () => {
    const raw = [REAL_LINE_1, TEST_LINE_1, MALFORMED_LINE, REAL_LINE_2, TEST_LINE_2].join('\n') + '\n';
    const { kept, quarantined } = partitionSignalsContent(raw);
    expect(kept).toEqual([REAL_LINE_1, MALFORMED_LINE, REAL_LINE_2]);
    expect(quarantined).toEqual([TEST_LINE_1, TEST_LINE_2]);
  });

  it('drops a trailing blank element from a trailing newline without treating it as a line', () => {
    const raw = REAL_LINE_1 + '\n';
    const { kept, quarantined } = partitionSignalsContent(raw);
    expect(kept).toEqual([REAL_LINE_1]);
    expect(quarantined).toEqual([]);
  });
});

describe('quarantineEngineerSignals', () => {
  it('prints/report a no-op when signals.jsonl is missing (exit-0 semantics)', async () => {
    const result = await quarantineEngineerSignals({ engineerDir: scratchDir });
    expect(result.existed).toBe(false);
    expect(result.kept).toBe(0);
    expect(result.quarantined).toBe(0);
  });

  it('backs up the original file byte-for-byte before mutating anything', async () => {
    const raw = [REAL_LINE_1, TEST_LINE_1, MALFORMED_LINE].join('\n') + '\n';
    await writeFile(join(scratchDir, 'signals.jsonl'), raw, 'utf-8');

    const result = await quarantineEngineerSignals({ engineerDir: scratchDir, now: () => new Date('2026-07-23T12:00:00.000Z') });

    expect(result.backupPath).toBeDefined();
    const backupContent = await readFile(result.backupPath!, 'utf-8');
    expect(backupContent).toBe(raw);
  });

  it('rewrites the live file with only kept lines, appends quarantined lines, and reports counts', async () => {
    const raw = [REAL_LINE_1, TEST_LINE_1, MALFORMED_LINE, REAL_LINE_2, TEST_LINE_2].join('\n') + '\n';
    await writeFile(join(scratchDir, 'signals.jsonl'), raw, 'utf-8');

    const result = await quarantineEngineerSignals({ engineerDir: scratchDir });

    expect(result.kept).toBe(3);
    expect(result.quarantined).toBe(2);
    expect(result.total).toBe(5);

    const liveContent = await readFile(join(scratchDir, 'signals.jsonl'), 'utf-8');
    expect(liveContent).toBe([REAL_LINE_1, MALFORMED_LINE, REAL_LINE_2].join('\n') + '\n');

    const quarantineContent = await readFile(join(scratchDir, 'signals.jsonl.test-quarantine'), 'utf-8');
    expect(quarantineContent).toBe([TEST_LINE_1, TEST_LINE_2].join('\n') + '\n');
  });

  it('appends to a prior quarantine run rather than overwriting it', async () => {
    await writeFile(join(scratchDir, 'signals.jsonl'), [REAL_LINE_1, TEST_LINE_1].join('\n') + '\n', 'utf-8');
    await quarantineEngineerSignals({ engineerDir: scratchDir });

    // Simulate a fresh batch of real writes plus one more test-project line.
    await writeFile(join(scratchDir, 'signals.jsonl'), [REAL_LINE_2, TEST_LINE_2].join('\n') + '\n', 'utf-8');
    await quarantineEngineerSignals({ engineerDir: scratchDir });

    const quarantineContent = await readFile(join(scratchDir, 'signals.jsonl.test-quarantine'), 'utf-8');
    expect(quarantineContent).toBe([TEST_LINE_1, TEST_LINE_2].join('\n') + '\n');
  });

  it('--dry-run performs no mutations: no backup, no rewrite, no quarantine append', async () => {
    const raw = [REAL_LINE_1, TEST_LINE_1].join('\n') + '\n';
    await writeFile(join(scratchDir, 'signals.jsonl'), raw, 'utf-8');

    const result = await quarantineEngineerSignals({ engineerDir: scratchDir, dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.kept).toBe(1);
    expect(result.quarantined).toBe(1);
    expect(result.backupPath).toBeUndefined();

    // Live file unchanged.
    const liveContent = await readFile(join(scratchDir, 'signals.jsonl'), 'utf-8');
    expect(liveContent).toBe(raw);

    // No backup or quarantine file created.
    await expect(access(join(scratchDir, 'signals.jsonl.test-quarantine'))).rejects.toThrow();
  });

  it('is idempotent: a second real run quarantines 0 additional lines', async () => {
    await writeFile(join(scratchDir, 'signals.jsonl'), [REAL_LINE_1, TEST_LINE_1, TEST_LINE_2].join('\n') + '\n', 'utf-8');

    const first = await quarantineEngineerSignals({ engineerDir: scratchDir });
    expect(first.quarantined).toBe(2);

    const second = await quarantineEngineerSignals({ engineerDir: scratchDir });
    expect(second.quarantined).toBe(0);
    expect(second.kept).toBe(1);
  });
});

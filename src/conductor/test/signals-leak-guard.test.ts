import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { snapshotEngineerSignals, diffEngineerSignals } from '../test/signals-leak-guard.js';

const SIGNALS_LOG = 'signals.jsonl';

describe('signals-leak-guard: snapshotEngineerSignals & diffEngineerSignals', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `signals-leak-guard-test-${Date.now()}-${Math.random()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('detects an increase in test-project signal lines', async () => {
    await writeFile(
      join(tmpDir, SIGNALS_LOG),
      [JSON.stringify({ project: 'test-project', feature: 'a' })].join('\n') + '\n',
      'utf-8',
    );
    const before = await snapshotEngineerSignals(tmpDir);
    expect(before.exists).toBe(true);
    expect(before.testProjectLineCount).toBe(1);

    await writeFile(
      join(tmpDir, SIGNALS_LOG),
      [
        JSON.stringify({ project: 'test-project', feature: 'a' }),
        JSON.stringify({ project: 'test-project', feature: 'b' }),
      ].join('\n') + '\n',
      'utf-8',
    );
    const after = await snapshotEngineerSignals(tmpDir);
    expect(after.testProjectLineCount).toBe(2);

    const diff = diffEngineerSignals(before, after);
    expect(diff.addedTestProjectLines).toBe(1);
  });

  it('ignores legitimate additions of a real (non-test-project) project', async () => {
    await writeFile(
      join(tmpDir, SIGNALS_LOG),
      [JSON.stringify({ project: 'test-project', feature: 'a' })].join('\n') + '\n',
      'utf-8',
    );
    const before = await snapshotEngineerSignals(tmpDir);

    await writeFile(
      join(tmpDir, SIGNALS_LOG),
      [
        JSON.stringify({ project: 'test-project', feature: 'a' }),
        JSON.stringify({ project: 'real-project', feature: 'b' }),
      ].join('\n') + '\n',
      'utf-8',
    );
    const after = await snapshotEngineerSignals(tmpDir);

    const diff = diffEngineerSignals(before, after);
    expect(diff.addedTestProjectLines).toBe(0);
  });

  it('returns clean snapshot when signals.jsonl does not exist', async () => {
    const before = await snapshotEngineerSignals(tmpDir);
    expect(before.exists).toBe(false);
    expect(before.testProjectLineCount).toBe(0);

    const after = await snapshotEngineerSignals(tmpDir);
    const diff = diffEngineerSignals(before, after);
    expect(diff.addedTestProjectLines).toBe(0);
  });

  it('skips malformed lines without throwing or counting them', async () => {
    await writeFile(
      join(tmpDir, SIGNALS_LOG),
      [
        JSON.stringify({ project: 'test-project', feature: 'a' }),
        'not valid json {{{',
        '',
      ].join('\n') + '\n',
      'utf-8',
    );
    const snap = await snapshotEngineerSignals(tmpDir);
    expect(snap.exists).toBe(true);
    expect(snap.testProjectLineCount).toBe(1);
  });
});

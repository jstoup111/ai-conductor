import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectUnattributedDispatch,
  readDispatchAttribution,
  resolveAttributionAuditSamplePct,
} from '../../src/engine/attribution-telemetry.js';

describe('attribution telemetry', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it('parses attributed and unattributed dispatches without treating malformed lines as work', async () => {
    root = await mkdtemp(join(tmpdir(), 'attribution-telemetry-'));
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(
      join(root, '.pipeline', 'dispatch-count'),
      'Task: 1\nTask: none\nnoise\nTask: 2\nTask: none\n',
      'utf-8',
    );

    await expect(readDispatchAttribution(root)).resolves.toEqual({
      attributed: 2,
      unattributed: 2,
      taskIds: ['1', '2'],
    });
  });

  it('emits a streak signal only at the advisory threshold', () => {
    expect(detectUnattributedDispatch({ attributed: 2, unattributed: 2, taskIds: ['1', '2'] }))
      .toBeNull();
    expect(detectUnattributedDispatch({ attributed: 0, unattributed: 3, taskIds: [] }))
      .toEqual({ triggered: true, reason: 'unattributed_dispatch', unattributedCount: 3 });
  });

  it('defaults audit sampling to ten percent', () => {
    expect(resolveAttributionAuditSamplePct({})).toBe(10);
    expect(resolveAttributionAuditSamplePct({ attribution_audit_sample_pct: 25 })).toBe(25);
  });
});

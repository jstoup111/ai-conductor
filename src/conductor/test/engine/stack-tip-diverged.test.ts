// Covers: task:20, task:rem-prd-audit-rem-v3-divergence-mapping
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isRecordableHaltClass } from '../../src/engine/halt-record.js';
import {
  readHaltClass,
  STACK_TIP_DIVERGED_HALT_CLASS,
} from '../../src/engine/halt-marker.js';
import { RETAINED_HALT_CLASSES } from '../../src/engine/daemon-rekick.js';
import { haltStackTipDiverged } from '../../src/engine/stack-publication.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('stack-tip-diverged halt', () => {
  it('is an operator-recordable retained halt that renders divergent positions and emits their PRs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stack-tip-diverged-'));
    roots.push(root);
    const events: unknown[] = [];
    await haltStackTipDiverged(root, [{ pr: 103, position: 3 }, { pr: 500, position: 5 }], { emit: async (event) => { events.push(event); } });

    await expect(readHaltClass(root)).resolves.toBe(STACK_TIP_DIVERGED_HALT_CLASS);
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('positions: 3, 5');
    expect(isRecordableHaltClass(STACK_TIP_DIVERGED_HALT_CLASS)).toBe(true);
    expect(RETAINED_HALT_CLASSES.has(STACK_TIP_DIVERGED_HALT_CLASS)).toBe(true);
    expect(events).toEqual([{ type: 'stack_tip_diverged', prs: [103, 500] }]);
  });
});

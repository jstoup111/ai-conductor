import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseTimeBlock } from '../../src/engine/kpi-report.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

describe('KPI shipped-record corpus', () => {
  it('preserves the parse states of committed reason-free partial and pre-Time records', async () => {
    const [reasonFreePartial, noTime] = await Promise.all([
      readFile(join(REPOSITORY_ROOT, '.docs/shipped/codex-readiness-distinguishes-unavailable-doctor-p.md'), 'utf8'),
      readFile(join(REPOSITORY_ROOT, '.docs/shipped/2026-04-12-phase-1-story-catalog.md'), 'utf8'),
    ]);

    expect({
      reasonFreePartial: parseTimeBlock(reasonFreePartial),
      noTime: parseTimeBlock(noTime),
    }).toEqual({
      reasonFreePartial: { state: 'partial' },
      noTime: { state: 'unavailable' },
    });
  });
});

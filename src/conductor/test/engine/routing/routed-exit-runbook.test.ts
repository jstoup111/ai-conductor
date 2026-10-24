// Covers: task:13
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('routed exit runbook', () => {
  it('documents the cascade-cap recovery under the routed repair heading', async () => {
    const runbook = await readFile(join(process.cwd(), '..', '..', 'docs', 'runbooks', 'stalled-or-stuck-feature.md'), 'utf8');
    expect(runbook).toContain('### Routed repair halted on the cascade cap');
  });
});

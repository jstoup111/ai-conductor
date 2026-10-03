import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveForegroundRunId } from '../../src/index.js';

describe('resolveForegroundRunId', () => {
  it('reuses the persisted run id on foreground resume', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-id-'));
    await writeFile(join(dir, 'conduct-session-id'), '0b6f1c2e-1111-4222-8333-444455556666\n');
    expect(await resolveForegroundRunId(dir)).toBe('0b6f1c2e-1111-4222-8333-444455556666');
  });

  it('mints a fresh id when nothing is persisted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-id-'));
    const a = await resolveForegroundRunId(dir);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(await resolveForegroundRunId(dir)).not.toBe(a);
  });
});

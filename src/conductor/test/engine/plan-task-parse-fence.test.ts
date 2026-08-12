import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

describe('plan task Files convention fence', () => {
  it('does not retain the retired WIRED_INTO_LINE parser machinery', async () => {
    const source = await readFile(
      fileURLToPath(new URL('../../src/engine/plan-task-parse.ts', import.meta.url)),
      'utf8',
    );

    expect(source).not.toMatch(/\bWIRED_INTO_LINE\b/);
  });
});

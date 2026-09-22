// Covers: task:17
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

describe('rebase sweep judgement skill contract', () => {
  it('documents the closed verdict and declared-superseded skip exception', async () => {
    const skill = await readFile(resolve(process.cwd(), '../../skills/rebase/SKILL.md'), 'utf8');
    expect(skill).toContain('### Sweep Test-Only Judgement');
    expect(skill).toContain('"superseded"|"merged"|"source"');
    expect(skill).toContain('declared-superseded');
  });
});

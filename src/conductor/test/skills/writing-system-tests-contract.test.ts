// Covers: task:20
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('writing-system-tests stacked-child contract', () => {
  it('scopes stories and RED evidence to the supplied child without changing flat features', async () => {
    const skill = await readFile(
      resolve(process.cwd(), '../../skills/writing-system-tests/SKILL.md'),
      'utf8',
    );

    expect(skill).toContain('only the supplied owned stories');
    expect(skill).toContain('.pipeline/children/<k>/acceptance-specs-red.json');
    expect(skill).toContain('.pipeline/children/<k>/acceptance-specs-run.json');
    expect(skill).toContain('prior-child-green');
    expect(skill).toContain('supplied parent closure tip');
    expect(skill).toContain('.pipeline/acceptance-specs-red.json');
  });
});

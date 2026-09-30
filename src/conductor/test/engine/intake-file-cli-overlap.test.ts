// Covers: task:18
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('intake-file overlap wiring', () => {
  it('wires the source factory, decline option, and canonical renderer at the CLI boundary', async () => {
    const source = await readFile(new URL('../../src/intake-file-cli.ts', import.meta.url), 'utf8');
    expect(source).toContain("case '--decline-overlap'");
    expect(source).toContain('buildOverlapSources({ cwd, repository, gh })');
    expect(source).toContain('renderIntakeFileOutput(result)');
  });
});

import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dirnameHere = dirname(fileURLToPath(import.meta.url));
const daemonCliPath = join(dirnameHere, '../../src/daemon-cli.ts');

describe('daemon-cli teardown timeout wiring', () => {
  it('resolves the loaded config and passes the bounded timeout to daemon dependencies', async () => {
    const source = await readFile(daemonCliPath, 'utf-8');

    expect(source).toMatch(/resolveTeardownTimeoutSeconds/);
    expect(source).toMatch(/teardownTimeoutSeconds:\s*resolveTeardownTimeoutSeconds\(config\)/);
  });
});

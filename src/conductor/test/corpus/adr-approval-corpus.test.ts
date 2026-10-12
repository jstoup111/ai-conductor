import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { adrApprovalStatus } from '../../src/engine/artifacts.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

describe('ADR approval corpus', () => {
  it('accepts every ADR in the repository corpus', async () => {
    const decisionsDir = join(REPOSITORY_ROOT, '.docs', 'decisions');
    const adrPaths = (await readdir(decisionsDir))
      .filter((entry) => /^adr-.*\.md$/.test(entry))
      .map((entry) => join(decisionsDir, entry));
    const statuses = await Promise.all(
      adrPaths.map(async (path) => ({ path, ...(adrApprovalStatus(await readFile(path, 'utf-8'))) })),
    );

    expect(adrPaths).not.toHaveLength(0);
    expect({
      rejected: statuses.filter((status) => !status.approved && status.found !== null),
      unparseable: statuses.filter((status) => status.found === null),
    }).toEqual({ rejected: [], unparseable: [] });
  });
});

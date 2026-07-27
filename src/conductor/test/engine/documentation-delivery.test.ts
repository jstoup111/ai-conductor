import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function loadDocumentationDelivery() {
  return import('../../src/engine/documentation-delivery.js');
}

describe('documentation delivery reader', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'documentation-delivery-'));
    await mkdir(join(projectRoot, '.pipeline'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('accepts a versioned delivery whose PR branch and closing reference match the result', async () => {
    await writeFile(
      join(projectRoot, '.pipeline', 'documentation-delivery.json'),
      JSON.stringify({
        version: 1,
        branch: 'docs/update-installation',
        prUrl: 'https://github.com/acme/widgets/pull/42',
        sourceRef: 'acme/widgets#17',
      }),
    );
    const { readDocumentationDelivery } = await loadDocumentationDelivery();

    const result = await readDocumentationDelivery({
      projectRoot,
      gh: async () => ({
        stdout: JSON.stringify({
          headRefName: 'docs/update-installation',
          body: 'Updates installation guidance.\n\nCloses acme/widgets#17',
        }),
      }),
    });

    expect(result).toEqual({
      version: 1,
      branch: 'docs/update-installation',
      prUrl: 'https://github.com/acme/widgets/pull/42',
      sourceRef: 'acme/widgets#17',
    });
  });

  it('rejects a closing-reference substring that cannot close the source issue', async () => {
    await writeFile(
      join(projectRoot, '.pipeline', 'documentation-delivery.json'),
      JSON.stringify({
        version: 1,
        branch: 'docs/update-installation',
        prUrl: 'https://github.com/acme/widgets/pull/42',
        sourceRef: 'acme/widgets#17',
      }),
    );
    const { readDocumentationDelivery } = await loadDocumentationDelivery();

    await expect(
      readDocumentationDelivery({
        projectRoot,
        gh: async () => ({
          stdout: JSON.stringify({
            headRefName: 'docs/update-installation',
            body: 'Closes acme/widgets#17-notes',
          }),
        }),
      }),
    ).rejects.toThrow(/does not close/);
  });

  it('rejects a non-canonical source reference', async () => {
    await writeFile(
      join(projectRoot, '.pipeline', 'documentation-delivery.json'),
      JSON.stringify({
        version: 1,
        branch: 'docs/update-installation',
        prUrl: 'https://github.com/acme/widgets/pull/42',
        sourceRef: 'acme/widgets/extra#17',
      }),
    );
    const { readDocumentationDelivery } = await loadDocumentationDelivery();

    await expect(
      readDocumentationDelivery({
        projectRoot,
        gh: async () => ({ stdout: '{}' }),
      }),
    ).rejects.toThrow(/result is invalid/);
  });
});

// Covers: task:3
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveRefutationEvidence } from '../../src/engine/remediation-refutation-evidence.js';

const refutation = (path: string, excerpt: string) => ({
  claim: 'The finding is contradicted by the tree.',
  assertions: [{
    assertion: 'The implementation contains the claimed behavior.',
    verdict: 'refuted' as const,
    evidence: [{ path, excerpt }],
  }],
});

describe('refutation evidence resolver', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'remediation-refutation-evidence-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('accepts a canonical file containing the normalized excerpt', async () => {
    await writeFile(join(projectRoot, 'evidence.ts'), 'const result =  one\n  normalized excerpt;\n');

    await expect(resolveRefutationEvidence({
      projectRoot,
      refutation: refutation('evidence.ts', 'one normalized    excerpt'),
    })).resolves.toEqual({ ok: true });
  });

  it('rejects an outside or non-canonical evidence path', async () => {
    await expect(resolveRefutationEvidence({
      projectRoot,
      refutation: refutation('../outside.ts', 'irrelevant'),
    })).resolves.toEqual({
      ok: false,
      reason: 'unresolvable-refutation-evidence',
      path: '../outside.ts',
    });
  });

  it('reports the first existing path whose normalized excerpt is absent', async () => {
    await writeFile(join(projectRoot, 'evidence.ts'), 'const unrelated = true;\n');

    await expect(resolveRefutationEvidence({
      projectRoot,
      refutation: refutation('evidence.ts', 'missing excerpt'),
    })).resolves.toEqual({
      ok: false,
      reason: 'unresolvable-refutation-evidence',
      path: 'evidence.ts',
      excerpt: 'missing excerpt',
    });
  });

  it.each(['   \n\t ', '\n\n'])('rejects an empty normalized excerpt (%j)', async (excerpt) => {
    await writeFile(join(projectRoot, 'evidence.ts'), 'ordinary evidence contents\n');
    await expect(resolveRefutationEvidence({ projectRoot, refutation: refutation('evidence.ts', excerpt) })).resolves.toEqual({
      ok: false, reason: 'unresolvable-refutation-evidence', path: 'evidence.ts', excerpt,
    });
  });

  it('rejects a directory evidence path', async () => {
    await mkdir(join(projectRoot, 'evidence'));

    await expect(resolveRefutationEvidence({
      projectRoot,
      refutation: refutation('evidence', 'irrelevant'),
    })).resolves.toEqual({
      ok: false,
      reason: 'unresolvable-refutation-evidence',
      path: 'evidence',
    });
  });
});

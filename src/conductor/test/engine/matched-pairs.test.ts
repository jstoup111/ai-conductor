import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MATCHED_PAIR_REGISTRY,
  type MatchedPairDeclaration,
  type MatchedPairId,
} from '../../src/engine/matched-pairs.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

function assertDeclarationIsWellFormed(
  id: MatchedPairId,
  declaration: MatchedPairDeclaration,
): void {
  if (declaration.mode === 'satisfied-by-derivation') {
    expect(declaration.reason.trim(), `${id} reason`).not.toBe('');
    expect(
      /#\d+\b/.test(declaration.ref) || /^(?:adr-|docs\/)/.test(declaration.ref),
      `${id} ref`,
    ).toBe(true);
    return;
  }

  expect(declaration.authoritative.file, `${id} authoritative file`).not.toBe(declaration.compared.file);
  for (const side of [declaration.authoritative, declaration.compared]) {
    expect(side.file, `${id} ${side.name} file`).toMatch(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+/);
    expect(existsSync(join(repositoryRoot, side.file)), `${id} ${side.name} file`).toBe(true);
  }
}

describe('matched-pair registry', () => {
  it('declares all three seed pairs', () => {
    expect(Object.keys(MATCHED_PAIR_REGISTRY)).toHaveLength(3);
    expect(Object.keys(MATCHED_PAIR_REGISTRY).sort()).toEqual([
      'build-review-retired-ids-configuration-doc',
      'build-review-retired-ids-dispositions',
      'build-review-retired-reason-prefix',
    ]);
  });

  it('keeps every declaration well-formed', () => {
    for (const [id, declaration] of Object.entries(MATCHED_PAIR_REGISTRY) as [
      MatchedPairId,
      MatchedPairDeclaration,
    ][]) {
      assertDeclarationIsWellFormed(id, declaration);
    }
  });

  it('names the pair id and offending field for an empty derivation reason', () => {
    expect(() => assertDeclarationIsWellFormed(
      'build-review-retired-ids-dispositions',
      {
        mode: 'satisfied-by-derivation',
        derivingModule: 'src/conductor/src/engine/build-review-dispositions.ts',
        sourceModule: 'src/conductor/src/engine/config.ts',
        importedExport: 'DEPRECATED_BUILD_REVIEW_RUBRIC_IDS',
        reason: ' ',
        ref: 'jstoup111/ai-conductor#1833',
      },
    )).toThrow(/build-review-retired-ids-dispositions reason/);
  });
});

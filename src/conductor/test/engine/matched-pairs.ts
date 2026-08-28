/**
 * The SKILL.md build-review vocabulary pair remains owned by check 25
 * (`test/check_build_review_rubric_skill_vocabularies.sh`), not this registry.
 */

export type MatchedPairId =
  | 'build-review-retired-ids-dispositions'
  | 'build-review-retired-reason-prefix'
  | 'build-review-retired-ids-configuration-doc';

interface MatchedPairSide {
  readonly name: string;
  readonly file: string;
  readonly enumeration: string;
  readonly markdownAnchor?: string;
}

interface CheckedMatchedPairDeclaration {
  readonly mode: 'checked';
  readonly authoritative: MatchedPairSide;
  readonly compared: MatchedPairSide;
}

interface DerivedMatchedPairDeclaration {
  readonly mode: 'satisfied-by-derivation';
  readonly derivingModule: string;
  readonly sourceModule: string;
  readonly importedExport: string;
  readonly reason: string;
  readonly ref: string;
}

export type MatchedPairDeclaration =
  | CheckedMatchedPairDeclaration
  | DerivedMatchedPairDeclaration;

export const MATCHED_PAIR_REGISTRY = {
  'build-review-retired-ids-dispositions': {
    mode: 'satisfied-by-derivation',
    derivingModule: 'src/conductor/src/engine/build-review-dispositions.ts',
    sourceModule: 'src/conductor/src/engine/config.ts',
    importedExport: 'DEPRECATED_BUILD_REVIEW_RUBRIC_IDS',
    reason: 'Retired ids are derived as a set via the config import edge.',
    ref: 'jstoup111/ai-conductor#1833',
  },
  'build-review-retired-reason-prefix': {
    mode: 'satisfied-by-derivation',
    derivingModule: 'src/conductor/src/engine/build-review-aggregate.ts',
    sourceModule: 'src/conductor/src/engine/config.ts',
    importedExport: 'DEPRECATED_BUILD_REVIEW_RUBRIC_IDS',
    reason: 'Retired reason prefixes are derived from the config export.',
    ref: 'jstoup111/ai-conductor#1833',
  },
  'build-review-retired-ids-configuration-doc': {
    mode: 'checked',
    authoritative: {
      name: 'engine',
      file: 'src/conductor/src/engine/config.ts',
      enumeration: 'DEPRECATED_BUILD_REVIEW_RUBRIC_IDS',
    },
    compared: {
      name: 'configuration documentation',
      file: 'docs/reference/configuration.md',
      enumeration: 'retired build-review rubric ids',
      markdownAnchor: 'Every other id ever accepted',
    },
  },
} satisfies Record<MatchedPairId, MatchedPairDeclaration>;

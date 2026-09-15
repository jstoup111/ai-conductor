// Covers: task:1
import { describe, expect, it } from 'vitest';
import { posix } from 'node:path';

interface HeaderCallerClaimViolation {
  claimantPath: string;
  line: number;
  sentence: string;
  identifier?: string;
  consumers: string[];
}

type ClaimKind = 'module' | 'symbol';

interface HeaderCallerClaim {
  kind: ClaimKind;
  line: number;
  sentence: string;
  symbol?: string;
}

const CLAIM_VOCABULARY: ReadonlyArray<{
  kind: ClaimKind;
  pattern: RegExp;
}> = [
  {
    kind: 'module',
    pattern: /\bnothing imports (?:it|this module)\b/i,
  },
  {
    kind: 'module',
    pattern: /\bno (?:callers|importers)\b/i,
  },
  {
    kind: 'module',
    pattern: /\bthis module (?:is|remains) inert\b/i,
  },
  {
    kind: 'symbol',
    pattern: /\bnothing (?:calls|uses|invokes) `(?<symbol>[A-Za-z_$][\w$]*)`/i,
  },
];

function leadingCommentBlock(source: string): Array<{ line: number; text: string }> {
  const block: Array<{ line: number; text: string }> = [];

  for (const [index, line] of source.split('\n').entries()) {
    const trimmed = line.trim();
    if (
      trimmed === ''
      || trimmed.startsWith('//')
      || trimmed.startsWith('/*')
      || trimmed.startsWith('*')
      || trimmed.startsWith('*/')
    ) {
      block.push({ line: index + 1, text: trimmed.replace(/^\/\/?\*?\s?/, '').replace(/^\*\/?\s?/, '') });
      continue;
    }
    break;
  }

  return block;
}

function headerClaims(source: string): HeaderCallerClaim[] {
  return leadingCommentBlock(source).flatMap(({ line, text }) => {
    const claim = CLAIM_VOCABULARY.find((candidate) => candidate.pattern.test(text));
    if (!claim) return [];
    const match = claim.pattern.exec(text)!;
    return [{
      kind: claim.kind,
      line,
      sentence: text,
      ...(match.groups?.symbol === undefined ? {} : { symbol: match.groups.symbol }),
    }];
  });
}

function relativeImportTargets(source: string): string[] {
  return [...source.matchAll(/\b(?:from\s+|import\s*)['"](\.{1,2}\/[^'"]+)['"]/g)]
    .map((match) => match[1]);
}

function resolveRelativeImport(importerPath: string, specifier: string): string {
  const emittedPath = specifier.endsWith('.js') ? `${specifier.slice(0, -3)}.ts` : specifier;
  return posix.resolve('/', posix.dirname(importerPath), emittedPath).slice(1);
}

function consumersOfModule(
  files: ReadonlyMap<string, string>,
  claimantPath: string,
): string[] {
  return [...files]
    .filter(([path, source]) => path !== claimantPath
      && relativeImportTargets(source).some((specifier) => resolveRelativeImport(path, specifier) === claimantPath))
    .map(([path]) => path)
    .sort();
}

function consumersOfSymbol(
  files: ReadonlyMap<string, string>,
  claimantPath: string,
  symbol: string,
): string[] {
  const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const occurrence = new RegExp(`(?<![A-Za-z0-9_$])${escapedSymbol}(?![A-Za-z0-9_$])`);
  return [...files]
    .filter(([path, source]) => path !== claimantPath && occurrence.test(source))
    .map(([path]) => path)
    .sort();
}

function findHeaderCallerClaimViolations(
  files: ReadonlyMap<string, string>,
): HeaderCallerClaimViolation[] {
  return [...files].flatMap(([claimantPath, source]) => headerClaims(source).flatMap((claim) => {
    const consumers = claim.kind === 'module'
      ? consumersOfModule(files, claimantPath)
      : consumersOfSymbol(files, claimantPath, claim.symbol!);
    if (consumers.length === 0) return [];
    return [{
      claimantPath,
      line: claim.line,
      sentence: claim.sentence,
      ...(claim.symbol === undefined ? {} : { identifier: claim.symbol }),
      consumers,
    }];
  }));
}

describe('module header caller claims', () => {
  it('reports a module header that claims nothing imports it', () => {
    const violations = findHeaderCallerClaimViolations(new Map([
      ['src/engine/claimant.ts', '// This module is inert — nothing imports it.\nexport const value = 1;\n'],
      ['src/engine/consumer.ts', "import { value } from './claimant.js';\nvoid value;\n"],
    ]));

    expect(violations).toEqual([{
      claimantPath: 'src/engine/claimant.ts',
      line: 1,
      sentence: 'This module is inert — nothing imports it.',
      consumers: ['src/engine/consumer.ts'],
    }]);
  });

  it('reports a header that claims nothing calls a backticked export', () => {
    const violations = findHeaderCallerClaimViolations(new Map([
      ['src/engine/claimant.ts', '// Nothing calls `perform$Gate` yet.\nexport function perform$Gate() {}\n'],
      ['src/engine/consumer.ts', "import { perform$Gate } from './claimant.js';\nperform$Gate();\n"],
    ]));

    expect(violations).toEqual([{
      claimantPath: 'src/engine/claimant.ts',
      line: 1,
      sentence: 'Nothing calls `perform$Gate` yet.',
      identifier: 'perform$Gate',
      consumers: ['src/engine/consumer.ts'],
    }]);
  });
});

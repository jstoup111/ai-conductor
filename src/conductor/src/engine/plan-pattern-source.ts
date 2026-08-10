import { posix, win32 } from 'node:path';

export const PATTERN_SOURCE_HEADER = /^\s*\*\*Pattern-source:\*\*\s*(.*?)\s*$/im;
export const RENAME_MAP_HEADER = /^\s*\*\*Rename-map:\*\*\s*(.*?)\s*$/im;

export type RenameMapPair = { source: string; target: string };
export type PatternSourceFileExists = (path: string) => Promise<boolean>;
export type PlanPatternSourceMalformed = { kind: 'malformed'; message: string };

export type PlanPatternSourceResolution =
  | { kind: 'resolved'; sourcePath: string; renameMap: RenameMapPair[] }
  | { kind: 'absent' }
  | PlanPatternSourceMalformed;

const RENAME_MAP_ACCEPTED_FORMS = [
  '`source -> target`',
  'multiple comma-separated `source -> target` pairs',
];

function malformed(message: string): PlanPatternSourceMalformed {
  return { kind: 'malformed', message };
}

function normalizePatternSourceReference(reference: string): string {
  const inlineCode = reference.match(/^`([^`]*)`/);
  if (inlineCode) return inlineCode[1].trim();

  const markdown = reference.match(
    /^\[[^\]]+\]\(([^\s)]+)(?:\s+['"][^)]*['"])?\)/,
  );
  if (markdown) return markdown[1];

  return reference.trim().split(/\s+/, 1)[0] ?? '';
}

function parseRenameMap(value: string): RenameMapPair[] | PlanPatternSourceMalformed {
  const pairs: RenameMapPair[] = [];
  for (const rawPair of value.split(',')) {
    const pair = rawPair.trim();
    const parts = pair.split('->');
    if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
      return malformed(
        `**Rename-map:** pair "${pair}" is invalid. Accepted forms are: ${RENAME_MAP_ACCEPTED_FORMS.join('; ')}.`,
      );
    }
    pairs.push({ source: parts[0].trim(), target: parts[1].trim() });
  }
  return pairs;
}

function isMalformed(result: RenameMapPair[] | PlanPatternSourceMalformed): result is PlanPatternSourceMalformed {
  return !Array.isArray(result);
}

function resolveSourcePath(planRepoPath: string, reference: string): string | null {
  const normalizedPlanPath = posix.normalize(planRepoPath.replaceAll('\\', '/'));
  if (!normalizedPlanPath.startsWith('.docs/')) return null;

  if (!reference || posix.isAbsolute(reference) || win32.isAbsolute(reference)) return null;
  const normalized = posix.normalize(reference.replaceAll('\\', '/'));
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.split('/').includes('..') ||
    posix.isAbsolute(normalized)
  ) {
    return null;
  }
  return normalized;
}

/**
 * Resolve a complete declared pattern relationship. Both header lines must be
 * present; an entirely undeclared relationship is the only `absent` result.
 * Source existence is injected so callers can enforce the boundary without
 * coupling this parser to a particular filesystem root.
 */
export async function resolvePlanPatternSource(
  planRepoPath: string,
  planContent: string,
  fileExists: PatternSourceFileExists,
): Promise<PlanPatternSourceResolution> {
  const sourceMatch = planContent.match(PATTERN_SOURCE_HEADER);
  const renameMapMatch = planContent.match(RENAME_MAP_HEADER);
  if (!sourceMatch && !renameMapMatch) return { kind: 'absent' };
  if (!sourceMatch) return malformed('Missing required **Pattern-source:** line.');
  if (!renameMapMatch) return malformed('Missing required **Rename-map:** line.');

  const sourceReference = normalizePatternSourceReference(sourceMatch[1]);
  const sourcePath = resolveSourcePath(planRepoPath, sourceReference);
  if (!sourcePath) {
    const reason = sourceReference.includes('..') ? 'traversal is not allowed' : 'must be a repository-relative path from a .docs/ plan';
    return malformed(`**Pattern-source:** path "${sourceReference}" is malformed: ${reason}.`);
  }

  const renameMap = parseRenameMap(renameMapMatch[1]);
  if (isMalformed(renameMap)) return renameMap;

  if (!(await fileExists(sourcePath))) {
    return malformed(`**Pattern-source:** path "${sourcePath}" does not exist.`);
  }

  return { kind: 'resolved', sourcePath, renameMap };
}

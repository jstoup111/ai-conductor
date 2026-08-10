export const PATTERN_SOURCE_HEADER = /^\s*\*\*Pattern-source:\*\*\s*(.*?)\s*$/im;
export const RENAME_MAP_HEADER = /^\s*\*\*Rename-map:\*\*\s*(.*?)\s*$/im;

export type RenameMapPair = { source: string; target: string };

export type PlanPatternSourceResolution =
  | { kind: 'resolved'; sourcePath: string; renameMap: RenameMapPair[] }
  | { kind: 'absent' };

function normalizePatternSourceReference(reference: string): string {
  const inlineCode = reference.match(/^`([^`]*)`/);
  if (inlineCode) return inlineCode[1].trim();

  const markdown = reference.match(
    /^\[[^\]]+\]\(([^\s)]+)(?:\s+['"][^)]*['"])?\)/,
  );
  if (markdown) return markdown[1];

  return reference.trim();
}

function parseRenameMap(planContent: string): RenameMapPair[] {
  const match = planContent.match(RENAME_MAP_HEADER);
  if (!match) return [];

  return match[1].split(',').map((pair) => {
    const [source, target] = pair.split('->');
    return { source: source.trim(), target: target.trim() };
  });
}

export function resolvePlanPatternSource(
  planContent: string,
): PlanPatternSourceResolution {
  const match = planContent.match(PATTERN_SOURCE_HEADER);
  if (!match) return { kind: 'absent' };

  return {
    kind: 'resolved',
    sourcePath: normalizePatternSourceReference(match[1]),
    renameMap: parseRenameMap(planContent),
  };
}

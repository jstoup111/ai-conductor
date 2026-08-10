export const PATTERN_SOURCE_HEADER = /^\s*\*\*Pattern-source:\*\*\s*(.*?)\s*$/im;

export type PlanPatternSourceResolution =
  | { kind: 'resolved'; sourcePath: string }
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

export function resolvePlanPatternSource(
  planContent: string,
): PlanPatternSourceResolution {
  const match = planContent.match(PATTERN_SOURCE_HEADER);
  if (!match) return { kind: 'absent' };

  return {
    kind: 'resolved',
    sourcePath: normalizePatternSourceReference(match[1]),
  };
}

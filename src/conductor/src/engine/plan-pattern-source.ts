export const PATTERN_SOURCE_HEADER = /^\s*\*\*Pattern-source:\*\*\s*(.*?)\s*$/im;

export type PlanPatternSourceResolution =
  | { kind: 'resolved'; sourcePath: string }
  | { kind: 'absent' };

export function resolvePlanPatternSource(
  planContent: string,
): PlanPatternSourceResolution {
  const match = planContent.match(PATTERN_SOURCE_HEADER);
  if (!match) return { kind: 'absent' };

  return { kind: 'resolved', sourcePath: match[1] };
}

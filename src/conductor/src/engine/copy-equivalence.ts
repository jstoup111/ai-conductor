import type { PlanPatternSourceResolution } from './plan-pattern-source.js';

type ResolvedPlanPatternSource = Extract<PlanPatternSourceResolution, { kind: 'resolved' }>;
export type CopyEquivalenceFileReader = (path: string) => Promise<string>;

export type CopyEquivalenceVerdict = {
  kind: 'equivalent';
  verifiedPair: { sourcePath: string; targetPath: string };
};

/**
 * The gate-facing outcome of an equivalence check. Unlike the per-task
 * floors, an invalid declared copy is a blocking condition for build_review.
 */
export type CopyEquivalenceStepResult =
  | { success: true; verdict: CopyEquivalenceVerdict }
  | { success: false; output: string };

function renameMapCollision(renameMap: ResolvedPlanPatternSource['renameMap']) {
  const targets = new Map<string, string>();
  for (const pair of renameMap) {
    const priorSource = targets.get(pair.target);
    if (priorSource !== undefined && priorSource !== pair.source) {
      return { priorSource, pair };
    }
    targets.set(pair.target, pair.source);
  }
  return undefined;
}

function firstDifferingRegion(expected: string, actual: string): { line: number; column: number } {
  let offset = 0;
  while (offset < expected.length && offset < actual.length && expected[offset] === actual[offset]) {
    offset += 1;
  }
  const prefix = expected.slice(0, offset);
  const line = prefix.split('\n').length;
  const lastNewline = prefix.lastIndexOf('\n');
  return { line, column: offset - lastNewline };
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return error instanceof Error ? error.message : undefined;
}

function applyRenameMap(source: string, renameMap: ResolvedPlanPatternSource['renameMap']): string {
  return renameMap.reduce(
    (content, pair) => content.replaceAll(pair.source, pair.target),
    source,
  );
}

/**
 * Compares one declared copy against its source after applying the declaration's
 * ordered rename map. Filesystem access stays injected so the primitive can be
 * used at an engine boundary without coupling its verdict to a filesystem root.
 */
async function verifyCopyEquivalence(
  declaration: ResolvedPlanPatternSource,
  targetPath: string,
  readFile: CopyEquivalenceFileReader,
): Promise<CopyEquivalenceVerdict> {
  const collision = renameMapCollision(declaration.renameMap);
  if (collision !== undefined) {
    throw new Error(
      `Copy equivalence rename-map collision: "${collision.priorSource}" and "${collision.pair.source}" both map to "${collision.pair.target}".`,
    );
  }

  let target: string;
  try {
    target = await readFile(targetPath);
  } catch {
    throw new Error(`Copy equivalence missing target: ${targetPath}.`);
  }

  let source: string;
  try {
    source = await readFile(declaration.sourcePath);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new Error(`Copy equivalence unexpected target: ${targetPath}.`);
    }
    throw new Error(`Copy equivalence cannot read source: ${declaration.sourcePath}.`);
  }

  const expected = applyRenameMap(source, declaration.renameMap);
  if (expected !== target) {
    const { line, column } = firstDifferingRegion(expected, target);
    throw new Error(`Copy equivalence content mismatch for ${targetPath} at line ${line}, column ${column}.`);
  }

  return {
    kind: 'equivalent',
    verifiedPair: { sourcePath: declaration.sourcePath, targetPath },
  };
}

/**
 * Converts the diagnostic-oriented comparison primitive into the outcome a
 * step runner can return. Task 8 owns invoking this from build_review.
 */
export async function runCopyEquivalence(
  declaration: ResolvedPlanPatternSource,
  targetPath: string,
  readFile: CopyEquivalenceFileReader,
): Promise<CopyEquivalenceStepResult> {
  try {
    return { success: true, verdict: await verifyCopyEquivalence(declaration, targetPath, readFile) };
  } catch (error) {
    return { success: false, output: error instanceof Error ? error.message : String(error) };
  }
}

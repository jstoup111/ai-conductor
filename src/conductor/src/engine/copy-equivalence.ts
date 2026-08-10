import type { PlanPatternSourceResolution } from './plan-pattern-source.js';

type ResolvedPlanPatternSource = Extract<PlanPatternSourceResolution, { kind: 'resolved' }>;
export type CopyEquivalenceFileReader = (path: string) => Promise<string>;

export type CopyEquivalenceVerdict = {
  kind: 'equivalent';
  verifiedPair: { sourcePath: string; targetPath: string };
};

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
export async function verifyCopyEquivalence(
  declaration: ResolvedPlanPatternSource,
  targetPath: string,
  readFile: CopyEquivalenceFileReader,
): Promise<CopyEquivalenceVerdict> {
  const [source, target] = await Promise.all([
    readFile(declaration.sourcePath),
    readFile(targetPath),
  ]);

  if (applyRenameMap(source, declaration.renameMap) !== target) {
    throw new Error(`Copy equivalence failed for ${declaration.sourcePath} -> ${targetPath}.`);
  }

  return {
    kind: 'equivalent',
    verifiedPair: { sourcePath: declaration.sourcePath, targetPath },
  };
}

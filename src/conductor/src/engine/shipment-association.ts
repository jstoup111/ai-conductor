export interface ShipmentAssociationInput {
  planStems: readonly string[];
  pr: {
    /** Exact plan-stem values extracted from authoritative PR metadata. */
    metadataPlanStems: readonly string[];
    changedPaths: readonly string[];
  };
}

export type ShipmentAssociationResult =
  | { kind: 'implementation'; slug: string }
  | {
    kind: 'not-applicable';
    classification: ShipmentAssociationClassification;
    diagnostic: string;
  };

export type ShipmentAssociationClassification =
  | 'spec-only'
  | 'plan-only'
  | 'docs-only'
  | 'record-only-repair'
  | 'zero-match'
  | 'multi-match';

/**
 * Classifies only evidence supplied by the caller. It deliberately performs no
 * GitHub or filesystem I/O, and does not infer an association from fuzzy text.
 */
export function classifyShipmentAssociation(
  input: ShipmentAssociationInput,
): ShipmentAssociationResult {
  const paths = uniqueNonEmpty(input.pr.changedPaths);
  const changeClassification = classifyNonImplementationChange(paths);
  if (changeClassification) return notApplicable(changeClassification);

  const planStems = new Set(uniqueNonEmpty(input.planStems));
  const matches = uniqueNonEmpty(input.pr.metadataPlanStems)
    .filter((stem) => planStems.has(stem));

  if (matches.length === 0) return notApplicable('zero-match');
  if (matches.length > 1) return notApplicable('multi-match');
  return { kind: 'implementation', slug: matches[0] };
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function classifyNonImplementationChange(
  paths: readonly string[],
): Exclude<ShipmentAssociationClassification, 'zero-match' | 'multi-match'> | undefined {
  if (paths.length === 0) return 'docs-only';
  if (paths.every((path) => path.startsWith('.docs/shipped/'))) return 'record-only-repair';
  if (paths.every((path) => path.startsWith('.docs/plans/'))) return 'plan-only';
  if (paths.every(isSpecPath)) return 'spec-only';
  if (paths.every(isDocumentationPath)) return 'docs-only';
  return undefined;
}

function isSpecPath(path: string): boolean {
  return path.startsWith('.docs/stories/') || path.startsWith('.docs/prd/');
}

function isDocumentationPath(path: string): boolean {
  return path.startsWith('.docs/')
    || path.startsWith('docs/')
    || path === 'CHANGELOG.md'
    || /(^|\/)README(\.[A-Za-z]+)?$/i.test(path)
    || /\.(md|mdx|txt|rst)$/i.test(path);
}

function notApplicable(
  classification: ShipmentAssociationClassification,
): Extract<ShipmentAssociationResult, { kind: 'not-applicable' }> {
  return {
    kind: 'not-applicable',
    classification,
    diagnostic: `shipment association is ${classification}`,
  };
}

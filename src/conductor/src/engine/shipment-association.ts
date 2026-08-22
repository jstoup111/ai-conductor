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

/** A non-blocking review finding retained with the shipped spec for #1810. */
export type RecordedShipmentFinding =
  | {
    gate: 'prd_audit';
    grade: 'PLAN_GAP';
    criterion: string;
    summary: string;
  }
  | {
    gate: 'architecture_review_as_built';
    grade: 'PLAN_GAP';
    outcome: string;
    summary: string;
  };

/**
 * Reads only findings that the two SHIP review gates explicitly recorded.
 * A plain verdict is not enough: the record is a durable handoff, so an
 * absent or malformed finding stays absent rather than being inferred.
 */
export function recordedShipmentFindings(input: {
  prdAudit?: string;
  asBuilt?: string;
}): RecordedShipmentFinding[] {
  return [
    ...recordedPrdAuditFindings(input.prdAudit),
    ...recordedAsBuiltFindings(input.asBuilt),
  ];
}

/** Adds the structured handoff to shipped-record frontmatter when present. */
export function appendRecordedShipmentFindings(
  record: string,
  findings: readonly RecordedShipmentFinding[],
): string {
  if (findings.length === 0) return record;
  const frontmatterEnd = record.indexOf('\n---\n', 4);
  if (frontmatterEnd === -1) return record;
  const rendered = findings.map((finding) => [
    `  - gate: ${finding.gate}`,
    `    grade: ${finding.grade}`,
    'criterion' in finding
      ? `    criterion: ${yamlScalar(finding.criterion)}`
      : `    outcome: ${yamlScalar(finding.outcome)}`,
    `    summary: ${yamlScalar(finding.summary)}`,
  ].join('\n')).join('\n');
  return `${record.slice(0, frontmatterEnd)}\nfindings:\n${rendered}${record.slice(frontmatterEnd)}`;
}

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

function recordedPrdAuditFindings(report: string | undefined): RecordedShipmentFinding[] {
  const block = report?.match(/^## Recorded Findings\s*\n+```json\s*\n([\s\S]*?)\n```\s*$/im)?.[1];
  if (!block) return [];
  try {
    const parsed: unknown = JSON.parse(block);
    const findings = parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as { findings?: unknown }).findings)
      ? (parsed as { findings: unknown[] }).findings
      : [];
    return findings.flatMap((finding) => {
      if (!isObject(finding) || finding.gate !== 'prd_audit' || finding.grade !== 'PLAN_GAP') return [];
      const criterion = nonEmptyString(finding.criterion);
      const summary = nonEmptyString(finding.summary);
      return criterion && summary ? [{ gate: 'prd_audit', grade: 'PLAN_GAP', criterion, summary }] : [];
    });
  } catch {
    return [];
  }
}

function recordedAsBuiltFindings(report: string | undefined): RecordedShipmentFinding[] {
  if (!report || !/^\s*Verdict\s*:\s*PLAN_GAP\s*$/im.test(report) || !/^\s*Outcome delivered\s*:\s*yes\s*$/im.test(report)) return [];
  const heading = /^## Recorded Findings\s*$/im.exec(report);
  if (!heading || heading.index === undefined) return [];
  const afterHeading = report.slice(heading.index + heading[0].length);
  const nextHeading = afterHeading.search(/^#{1,6}\s/m);
  const section = (nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading)).trim();
  if (!section) return [];
  const entries = section.split('\n').map((line) => line.trim()).filter(Boolean);
  const labeled = (name: string): string | undefined => entries
    .map((line) => line.match(new RegExp(`^(?:[-*]\\s*)?${name}:\\s*(.+)$`, 'i'))?.[1]?.trim())
    .find((value): value is string => Boolean(value));
  const outcome = labeled('outcome') ?? entries[0]!.replace(/^[-*]\s*/, '');
  const summary = labeled('summary') ?? section.replace(/\s+/g, ' ').trim();
  return outcome && summary
    ? [{ gate: 'architecture_review_as_built', grade: 'PLAN_GAP', outcome, summary }]
    : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function yamlScalar(value: string): string {
  return /^[A-Za-z0-9._/-]+$/.test(value) ? value : JSON.stringify(value);
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

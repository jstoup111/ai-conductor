import { createHash } from 'node:crypto';

import {
  AcceptedWideningDecisionStore,
  readLegacyOverScopeDecisionDocument,
  type AcceptedWideningDecision,
  type AcceptedWideningDecisionReadResult,
  type AcceptedWideningFeatureIdentity,
  type AcceptedWideningLegacyMigrationResult,
  type LegacyOverScopeDecision,
  type LegacyOverScopeDecisionDocument,
} from './accepted-widenings.js';
import {
  RemediationCaseStore,
  type RemediationCaseFeatureIdentity,
  type RemediationCasePrdWideningRecord,
  type RemediationCaseStoreMutation,
  type RemediationCaseStoreMutationResult,
  type RemediationCaseStoreState,
} from './remediation-case-store.js';

const MAX_REFERENCE_LENGTH = 256;
const MAX_TEXT_LENGTH = 8_000;
const MAX_CASES = 128;

export interface PrdWideningMigrationDecisionStore {
  read(): Promise<AcceptedWideningDecisionReadResult>;
  migrateLegacy(
    document: LegacyOverScopeDecisionDocument,
    decisions: readonly AcceptedWideningDecision[],
  ): Promise<AcceptedWideningLegacyMigrationResult>;
}

export interface PrdWideningMigrationCaseStore {
  mutate(
    operation: (state: RemediationCaseStoreState) => Promise<RemediationCaseStoreMutation<boolean>>,
  ): Promise<RemediationCaseStoreMutationResult<boolean>>;
}

export interface MigrateLegacyPrdWideningDecisionsOptions {
  readonly decisionStore?: PrdWideningMigrationDecisionStore;
  readonly caseStore?: PrdWideningMigrationCaseStore;
}

export type MigrateLegacyPrdWideningDecisionsResult =
  | { readonly kind: 'absent'; readonly decisions: readonly []; readonly cases: readonly [] }
  | { readonly kind: 'already-migrated'; readonly decisions: readonly []; readonly cases: readonly [] }
  | {
      readonly kind: 'migrated';
      readonly decisions: readonly AcceptedWideningDecision[];
      readonly cases: readonly RemediationCasePrdWideningRecord[];
    }
  | { readonly kind: 'failed'; readonly reason: 'malformed-legacy' | 'unsupported-legacy-version' | 'unreadable-legacy' | 'unsupported-legacy-row' | 'case-write-failed' | 'decision-write-failed'; readonly decisions: readonly []; readonly cases: readonly [] };

interface MigrationProjection {
  readonly decisions: readonly AcceptedWideningDecision[];
  readonly cases: readonly RemediationCasePrdWideningRecord[];
}

function digest(...parts: readonly string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part).update('\0');
  return hash.digest('hex');
}

function bounded(value: string, maximum = MAX_TEXT_LENGTH): boolean {
  return value.trim().length > 0 && value.length <= maximum;
}

function sourceKey(row: LegacyOverScopeDecision): string {
  // Old named criteria were criterion-keyed; NC rows had evidence identity.
  return /^NC\.\d+$/i.test(row.criterion)
    ? `NC\0${row.summary}`
    : `criterion\0${row.criterion}`;
}

function supportedRow(row: LegacyOverScopeDecision): boolean {
  return bounded(row.criterion, MAX_REFERENCE_LENGTH) && bounded(row.summary) &&
    bounded(row.rationale) && bounded(row.operator, MAX_REFERENCE_LENGTH) &&
    bounded(row.decidedAt, MAX_REFERENCE_LENGTH);
}

/**
 * Projects the whole v1 document before writing either v2 authority or source
 * state. Every identity is a deterministic document-and-row derivative; no
 * current PRD report participates in this recovery path.
 */
function project(document: LegacyOverScopeDecisionDocument): MigrationProjection | undefined {
  const casesBySource = new Map<string, RemediationCasePrdWideningRecord>();
  const latestDecisionBySource = new Map<string, AcceptedWideningDecision>();
  const seenExactRows = new Set<string>();
  const decisions: AcceptedWideningDecision[] = [];

  for (const [index, row] of document.decisions.entries()) {
    if (!supportedRow(row)) return undefined;
    const exactRow = JSON.stringify(row);
    // v1 appends made exact replay inert. Preserve that semantic rather than
    // interpreting an old replay as an operator reversal after migration.
    if (seenExactRows.has(exactRow)) continue;
    seenExactRows.add(exactRow);

    const key = sourceKey(row);
    let record = casesBySource.get(key);
    if (!record) {
      const sourceDigest = digest(document.documentId, key);
      record = {
        id: `legacy-prd-case-${sourceDigest}`,
        domain: 'prd_widening',
        originalSources: [{ sourceId: `legacy-prd-source-${sourceDigest}`, snapshot: row.summary }],
        currentSources: [],
        relationships: [],
      };
      casesBySource.set(key, record);
    }
    const prior = latestDecisionBySource.get(key);
    // A non-identical old row with the same effective authority had no v1
    // authority effect. It has no representable v2 reversal either.
    if (prior?.authority === row.decision) continue;

    const rowId = digest(document.documentId, String(index));
    const originalSource = record.originalSources[0]!;
    const decision: AcceptedWideningDecision = {
      id: `legacy-decision-${rowId}`,
      criterion: row.criterion,
      authority: row.decision,
      rationale: row.rationale,
      operator: row.operator,
      originalSource: { id: originalSource.sourceId, snapshot: originalSource.snapshot },
      originalCaseId: record.id,
      offerEntryId: `legacy-entry-${rowId}`,
      ...(prior === undefined ? {} : { supersedes: { id: prior.id, revision: prior.revision } }),
      revision: decisions.length + 1,
    };
    decisions.push(decision);
    latestDecisionBySource.set(key, decision);
  }
  const cases = [...casesBySource.values()];
  return cases.length <= MAX_CASES ? { decisions, cases } : undefined;
}

function sameCase(
  left: RemediationCasePrdWideningRecord,
  right: RemediationCasePrdWideningRecord,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function materializeSources(
  store: PrdWideningMigrationCaseStore,
  projection: MigrationProjection,
): Promise<boolean> {
  const result = await store.mutate(async (state) => {
    const existing = state.version === 'v2' ? state.prdWideningCases : [];
    const additions: RemediationCasePrdWideningRecord[] = [];
    for (const record of projection.cases) {
      const found = existing.find((candidate) => candidate.id === record.id);
      if (found && !sameCase(found, record)) return { value: false };
      if (!found) additions.push(record);
    }
    if (existing.length + additions.length > MAX_CASES) return { value: false };
    if (!additions.length) return { value: true };
    return {
      value: true,
      nextState: {
        version: 'v2',
        feature: state.feature,
        cases: state.cases,
        prdWideningCases: [...existing, ...additions],
        suppressions: state.suppressions ?? [],
      },
    };
  });
  return result.ok && result.value;
}

function decisionStoreFailure(_result: AcceptedWideningLegacyMigrationResult): MigrateLegacyPrdWideningDecisionsResult {
  return { kind: 'failed', reason: 'decision-write-failed', decisions: [], cases: [] };
}

function remediationFeature(feature: AcceptedWideningFeatureIdentity): RemediationCaseFeatureIdentity {
  return { version: 'v1', repository: feature.repository, feature: feature.feature };
}

/**
 * Upgrades valid v1 decisions in their original document order. It first
 * materializes immutable original source snapshots, then atomically replaces
 * the v1 decision document, so a crash cannot create source-less acceptance.
 */
export async function migrateLegacyPrdWideningDecisions(
  projectRoot: string,
  feature: AcceptedWideningFeatureIdentity,
  options: MigrateLegacyPrdWideningDecisionsOptions = {},
): Promise<MigrateLegacyPrdWideningDecisionsResult> {
  const decisionStore = options.decisionStore ?? new AcceptedWideningDecisionStore(projectRoot, feature);
  const caseStore = options.caseStore ?? new RemediationCaseStore(
    projectRoot,
    remediationFeature(feature),
  );
  const legacy = await readLegacyOverScopeDecisionDocument(projectRoot);
  if (legacy.kind === 'absent') return { kind: 'absent', decisions: [], cases: [] };
  if (legacy.kind === 'malformed') return { kind: 'failed', reason: 'malformed-legacy', decisions: [], cases: [] };
  if (legacy.kind === 'unreadable') return { kind: 'failed', reason: 'unreadable-legacy', decisions: [], cases: [] };
  if (legacy.kind === 'unsupported') {
    // A completed migration has no v1 source document left to replay.
    const current = await decisionStore.read();
    return current.kind === 'valid'
      ? { kind: 'already-migrated', decisions: [], cases: [] }
      : { kind: 'failed', reason: 'unsupported-legacy-version', decisions: [], cases: [] };
  }
  const projection = project(legacy.document);
  if (!projection) return { kind: 'failed', reason: 'unsupported-legacy-row', decisions: [], cases: [] };
  if (!await materializeSources(caseStore, projection)) {
    return { kind: 'failed', reason: 'case-write-failed', decisions: [], cases: [] };
  }
  const migrated = await decisionStore.migrateLegacy(legacy.document, projection.decisions);
  if (!migrated.ok) return decisionStoreFailure(migrated);
  return migrated.kind === 'already-migrated'
    ? { kind: 'already-migrated', decisions: [], cases: [] }
    : { kind: 'migrated', decisions: projection.decisions, cases: projection.cases };
}

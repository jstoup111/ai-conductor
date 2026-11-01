import type { AcceptedWideningFeatureIdentity } from './accepted-widenings.js';
import { prdAuditTypedRouteReport } from './artifacts.js';
import { isPrdAuditNoOwnerOrdinal } from './prd-audit-contract.js';
import { readPrdAuditVerdict } from './prd-audit-verdict-store.js';
import {
  capturePrdWideningDecisions,
  parseLegacyPrdWideningClear,
  type CapturePrdWideningDecisionsOptions,
  type CapturePrdWideningDecisionsResult,
} from './prd-widening-capture.js';
import {
  migrateLegacyPrdWideningDecisions,
  type MigrateLegacyPrdWideningDecisionsResult,
} from './prd-widening-migration.js';

export type PreparePrdWideningEntryResult = {
  readonly migration: MigrateLegacyPrdWideningDecisionsResult;
  readonly capture: CapturePrdWideningDecisionsResult;
};

/**
 * The one pre-review entry used by both serial and validation-group PRD
 * routing. Calling it repeatedly is safe: migration and decision append are
 * both idempotent and capture defects stay visible to the caller.
 */
export async function preparePrdWideningEntry(input: {
  readonly projectRoot: string;
  readonly feature: AcceptedWideningFeatureIdentity;
  readonly priorHalt: string;
  readonly capture: Omit<CapturePrdWideningDecisionsOptions, 'offeredStoryCriteria'>;
}): Promise<PreparePrdWideningEntryResult> {
  const verdict = await readPrdAuditVerdict(input.projectRoot);
  const offeredStoryCriteria = verdict.kind === 'present'
    ? (() => {
        const typed = prdAuditTypedRouteReport(verdict.value);
        return {
          kind: 'available' as const,
          criteria: new Set(typed.report.findings
            .filter((finding) => finding.grade === 'OVER_SCOPE' && !isPrdAuditNoOwnerOrdinal(finding.criterion) &&
              typed.relations.get(finding.criterion) === 'outside-visible')
            .map((finding) => finding.criterion)),
        };
      })()
    : { kind: 'unavailable' as const };
  // Read the fenced legacy clear before the v1 replacement so migration can
  // retain valid histories in authored order. It must never use the retired
  // import path to grant a row D3 would reject during current-format capture.
  const legacyClear = parseLegacyPrdWideningClear(input.priorHalt);
  const carriesOfferReference = (() => {
    const match = input.priorHalt.match(/```json\s+over-scope-decisions\s*\n([\s\S]*?)\n```/i);
    if (!match) return false;
    try {
      const rows: unknown = JSON.parse(match[1]!);
      return Array.isArray(rows) && rows.some((row) => typeof row === 'object' && row !== null && !Array.isArray(row) &&
        (Object.hasOwn(row, 'offerEntryId') || Object.hasOwn(row, 'originalCaseId') || Object.hasOwn(row, 'originalSource')));
    } catch { return false; }
  })();
  const hasNoOwnerLegacyEntry = legacyClear.kind === 'supported' && legacyClear.entries.some((entry) => isPrdAuditNoOwnerOrdinal(entry.criterion));
  const offers = hasNoOwnerLegacyEntry && offeredStoryCriteria.kind === 'available' && !carriesOfferReference
    ? await input.capture.offerStore.mutate(async (state) => ({ value: state.version === 'v2' ? state.prdWideningCases : [] }))
    : undefined;
  const eligibleLegacyEntries = legacyClear.kind === 'supported' && offeredStoryCriteria.kind === 'available' && !carriesOfferReference && (offers === undefined || offers.ok)
    ? legacyClear.entries.filter((entry) => isPrdAuditNoOwnerOrdinal(entry.criterion)
      ? !offers?.value.some((offer) => offer.offeredCriterion === entry.criterion)
      : offeredStoryCriteria.criteria.has(entry.criterion))
    : [];
  const migration = await migrateLegacyPrdWideningDecisions(input.projectRoot, input.feature, {
    legacyClear: eligibleLegacyEntries.length > 0 && typeof input.capture.operator === 'string' && input.capture.operator.trim()
      ? { entries: eligibleLegacyEntries, operator: input.capture.operator.trim() }
      : undefined,
  });
  const capture = await capturePrdWideningDecisions(input.priorHalt, { ...input.capture, offeredStoryCriteria });
  return { migration, capture };
}

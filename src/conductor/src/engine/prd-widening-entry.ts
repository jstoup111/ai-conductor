import type { AcceptedWideningFeatureIdentity } from './accepted-widenings.js';
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
  readonly capture: CapturePrdWideningDecisionsOptions;
}): Promise<PreparePrdWideningEntryResult> {
  // Read the fenced legacy clear before the v1 replacement so migration can
  // atomically retain both histories in their authored order.
  const legacyClear = parseLegacyPrdWideningClear(input.priorHalt);
  const migration = await migrateLegacyPrdWideningDecisions(input.projectRoot, input.feature, {
    legacyClear: legacyClear.kind === 'supported' && typeof input.capture.operator === 'string' && input.capture.operator.trim()
      ? { entries: legacyClear.entries, operator: input.capture.operator.trim() }
      : undefined,
  });
  const capture = await capturePrdWideningDecisions(input.priorHalt, input.capture);
  return { migration, capture };
}

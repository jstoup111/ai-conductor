import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  AcceptedWideningDecisionStore,
  parseClearedOverScopeDecisions,
} from './accepted-widenings.js';
import { offeredCaseToPersistedOffer } from './prd-widening-offers.js';
import {
  readRemediationCaseStoreFeature,
  RemediationCaseStore,
  selectPrdWideningRemediationCases,
} from './remediation-case-store.js';

const HALT_CLEARED_PATH = '.pipeline/HALT.cleared';

function recordedDecisionNote(criterion: string, authority: 'accept' | 'refuse'): string {
  return `Over-scope decision: ${criterion} recorded as ${authority}.`;
}

/**
 * Renders the widening-decision context for a resume integrity halt. This is
 * deliberately a read-only composition of existing widening authority; it
 * neither captures a clear nor changes the case/decision stores.
 */
export async function renderRebaseFenceDecisionNote(projectRoot: string): Promise<string> {
  const featureRead = await readRemediationCaseStoreFeature(projectRoot);
  if (!featureRead.ok || featureRead.feature === undefined) return '';

  const caseStore = new RemediationCaseStore(projectRoot, featureRead.feature);
  const caseRead = await caseStore.read();
  if (!caseRead.ok) return '';

  const offers = (caseRead.state.version === 'v2'
    ? selectPrdWideningRemediationCases(caseRead.state.prdWideningCases)
    : [])
    .map(offeredCaseToPersistedOffer)
    .filter((offer): offer is NonNullable<typeof offer> => offer !== undefined);
  const offeredFindings = new Map(offers.map((offer) => [offer.criterion, offer.summary]));
  const decisionStore = new AcceptedWideningDecisionStore(projectRoot, {
    version: 1,
    repository: featureRead.feature.repository,
    feature: featureRead.feature.feature,
  });
  const decisionRead = await decisionStore.read();
  if (decisionRead.kind !== 'absent' && decisionRead.kind !== 'valid') {
    return 'The recorded decision state could not be read.';
  }

  let cleared = '';
  try {
    cleared = await readFile(join(projectRoot, HALT_CLEARED_PATH), 'utf8');
  } catch {
    // An absent clear is the ordinary pending-offer case. Other read failures
    // are equally non-authoritative, so do not fabricate a decision from them.
  }
  const parsedClear = parseClearedOverScopeDecisions(cleared, offeredFindings);
  if (parsedClear.kind === 'parsed' && parsedClear.decisions.length > 0) {
    return parsedClear.decisions
      .map((decision) => recordedDecisionNote(decision.criterion, decision.decision))
      .join('\n');
  }

  const recorded = decisionRead.kind === 'valid'
    ? decisionRead.state.decisions.filter((decision) => offeredFindings.has(decision.criterion)).at(-1)
    : undefined;
  if (recorded !== undefined) return recordedDecisionNote(recorded.criterion, recorded.authority);

  if (offers.length === 0) return '';
  return offers
    .map((offer) => `Over-scope decision: ${offer.criterion} awaiting a decision; run \`ai-conductor halt clear\` after recording it.`)
    .join('\n');
}

import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { AcceptedWideningDecisionStore } from './accepted-widenings.js';
import { offeredCaseToPersistedOffer } from './prd-widening-offers.js';
import {
  readRemediationCaseStoreFeature,
  RemediationCaseStore,
  selectPrdWideningRemediationCases,
} from './remediation-case-store.js';

const HALT_CLEARED_PATH = '.pipeline/HALT.cleared';
const REMEDIATION_CASES_PATH = '.pipeline/remediation-cases.json';

function recordedDecisionNote(criterion: string, authority: 'accept' | 'refuse'): string {
  return `Over-scope decision: ${criterion} recorded as ${authority}.`;
}

function unreadableCaseStoreNote(): string {
  return `The decision state in ${REMEDIATION_CASES_PATH} could not be read; repair it before the decision state can be trusted.`;
}

function unreadableDecisionStoreNote(): string {
  return 'The recorded decision state could not be read; repair .pipeline/accepted-widenings.json before the decision state can be trusted.';
}

function orphanedDecisionStateNote(path: string): string {
  return `Orphaned decision state in ${path}; restore ${REMEDIATION_CASES_PATH} or remove the orphaned decision state.`;
}

function unreadableClearNote(): string {
  return `The recorded clear state in ${HALT_CLEARED_PATH} could not be read; repair it before the decision state can be trusted.`;
}

// ai-conductor:session-command-context=operator-only
function clearDefectNote(defect: { kind: string; criterion?: string }): string {
  return `Unreadable over-scope decision${defect.criterion ? ` for ${defect.criterion}` : ''}: ${defect.kind}; correct the over-scope-decisions block and re-run \`ai-conductor halt clear\`.`;
}
// /ai-conductor:session-command-context

type ClearedDecisionDefect = { kind: 'malformed-block' | 'unknown-criterion' | 'invalid-decision' | 'missing-rationale'; criterion?: string };
type ClearedDecisions =
  | { kind: 'absent' }
  | { kind: 'parsed'; decisions: { criterion: string; decision: 'accept' | 'refuse' }[]; defects: ClearedDecisionDefect[] };

/**
 * Reads the operator-edited over-scope-decisions block for display only.
 * Capture authority stays with prd-widening-capture; each entry is judged on
 * its own so one bad row never hides a valid sibling in the note.
 */
function readClearedDecisions(body: string, offered: ReadonlyMap<string, string>): ClearedDecisions {
  const match = body.match(/```json\s+over-scope-decisions\s*\n([\s\S]*?)\n```/i);
  if (!match) return { kind: 'absent' };
  let entries: unknown;
  try { entries = JSON.parse(match[1]!); } catch { return { kind: 'parsed', decisions: [], defects: [{ kind: 'malformed-block' }] }; }
  if (!Array.isArray(entries)) return { kind: 'parsed', decisions: [], defects: [{ kind: 'malformed-block' }] };
  const decisions: { criterion: string; decision: 'accept' | 'refuse' }[] = [];
  const defects: ClearedDecisionDefect[] = [];
  for (const raw of entries) {
    const entry = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const criterion = typeof entry.criterion === 'string' ? entry.criterion.trim() : undefined;
    if (!criterion || !offered.has(criterion)) { defects.push({ kind: 'unknown-criterion', ...(criterion ? { criterion } : {}) }); continue; }
    if (entry.decision === 'pending' || entry.decision === undefined) continue;
    if (entry.decision !== 'accept' && entry.decision !== 'refuse') { defects.push({ kind: 'invalid-decision', criterion }); continue; }
    if (typeof entry.rationale !== 'string' || !entry.rationale.trim()) { defects.push({ kind: 'missing-rationale', criterion }); continue; }
    decisions.push({ criterion, decision: entry.decision });
  }
  return { kind: 'parsed', decisions, defects };
}

/**
 * Renders the widening-decision context for a resume integrity halt. This is
 * deliberately a read-only composition of existing widening authority; it
 * neither captures a clear nor changes the case/decision stores.
 */
export async function renderRebaseFenceDecisionNote(projectRoot: string): Promise<string> {
  const featureRead = await readRemediationCaseStoreFeature(projectRoot);
  if (!featureRead.ok) return unreadableCaseStoreNote();
  if (featureRead.feature === undefined) {
    const acceptedWideningsPath = join(projectRoot, '.pipeline', 'accepted-widenings.json');
    try {
      await access(acceptedWideningsPath);
      return orphanedDecisionStateNote('.pipeline/accepted-widenings.json');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return orphanedDecisionStateNote('.pipeline/accepted-widenings.json');
      }
    }

    let cleared = '';
    try {
      cleared = await readFile(join(projectRoot, HALT_CLEARED_PATH), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return unreadableClearNote();
    }
    if (readClearedDecisions(cleared, new Map()).kind !== 'absent') {
      return orphanedDecisionStateNote(HALT_CLEARED_PATH);
    }
    return '';
  }

  const caseStore = new RemediationCaseStore(projectRoot, featureRead.feature);
  const caseRead = await caseStore.read();
  if (!caseRead.ok) return unreadableCaseStoreNote();

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
  const notes = decisionRead.kind !== 'absent' && decisionRead.kind !== 'valid'
    ? [unreadableDecisionStoreNote()]
    : [];

  let cleared = '';
  let clearReadError = false;
  try {
    cleared = await readFile(join(projectRoot, HALT_CLEARED_PATH), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') clearReadError = true;
  }
  if (clearReadError) {
    notes.push(unreadableClearNote());
  } else {
    const parsedClear = readClearedDecisions(cleared, offeredFindings);
    if (parsedClear.kind === 'parsed') {
      notes.push(
      ...parsedClear.decisions.map((decision) => recordedDecisionNote(decision.criterion, decision.decision)),
      ...parsedClear.defects.map(clearDefectNote),
      );
    }
  }

  if (notes.length > 0) return notes.join('\n');

  const recorded = decisionRead.kind === 'valid'
    ? decisionRead.state.decisions.filter((decision) => offeredFindings.has(decision.criterion)).at(-1)
    : undefined;
  if (recorded !== undefined) return recordedDecisionNote(recorded.criterion, recorded.authority);

  if (offers.length === 0) return '';
  // ai-conductor:session-command-context=operator-only
  return offers
    .map((offer) => `Over-scope decision: ${offer.criterion} awaiting a decision; run \`ai-conductor halt clear\` after recording it.`)
    .join('\n');
  // /ai-conductor:session-command-context
}

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  isAsBuiltGoverningReference,
  stampAsBuiltFindingIds,
  validateAsBuiltVerdict,
  type AsBuiltFinding,
  type AsBuiltGoverningReference,
  type AsBuiltProviderVerdict,
  type AsBuiltVerdict,
} from './as-built-contract.js';
import { AS_BUILT_CHECKS, type AsBuiltPolicy } from './as-built-policy.js';

/** Engine-owned authority; the adjacent Markdown report is a derived view. */
export const AS_BUILT_VERDICT_PATH = '.pipeline/architecture-review-as-built.json';
export const AS_BUILT_REPORT_PATH = '.pipeline/architecture-review-as-built.md';

export interface RecordedAsBuiltFinding {
  readonly id: string;
  readonly class: 'REMEDIABLE' | 'DESIGN';
  readonly reference?: AsBuiltGoverningReference;
  readonly summary: string;
  readonly outcome: string;
}

export interface PersistedAsBuiltVerdict {
  readonly attemptId: string;
  readonly codeStamp: string | null;
  readonly verdict: AsBuiltVerdict;
  readonly policy: AsBuiltPolicy;
  readonly recordedFindings: readonly RecordedAsBuiltFinding[];
}

export type ReadAsBuiltVerdictResult =
  | { readonly kind: 'absent' }
  /** A valid v1 envelope is stale authority, not a malformed v2 verdict. */
  | { readonly kind: 'prior-version'; readonly version: 'v1' }
  | { readonly kind: 'unreadable'; readonly reason: string }
  | { readonly kind: 'present'; readonly value: PersistedAsBuiltVerdict };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validPolicy(value: unknown): value is AsBuiltPolicy {
  return isRecord(value) && AS_BUILT_CHECKS.every((check) => {
    const entry = value[check];
    return isRecord(entry) && typeof entry.enabled === 'boolean' && typeof entry.reason === 'string';
  });
}

function validRecordedFinding(value: unknown): value is RecordedAsBuiltFinding {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.summary !== 'string' ||
    typeof value.outcome !== 'string' || (value.class !== 'REMEDIABLE' && value.class !== 'DESIGN')) return false;
  if (value.class === 'REMEDIABLE') return value.reference !== undefined && isAsBuiltGoverningReference(value.reference);
  return value.reference === undefined || isAsBuiltGoverningReference(value.reference);
}

function isPriorAsBuiltVerdict(value: unknown): value is { readonly version: 'v1' } {
  return isRecord(value) && value.version === 'v1';
}

type PersistedVerdictValidation =
  | { readonly ok: true; readonly verdict: AsBuiltVerdict }
  | { readonly ok: false; readonly field: string; readonly requirement: string };

/** Persisted v2 findings must be the exact engine stamp of the provider contract result. */
function validatePersistedAsBuiltVerdict(value: unknown, attemptId: string): PersistedVerdictValidation {
  if (!isRecord(value)) return { ok: false, field: '', requirement: 'a verdict object is required' };
  const rawFindings = value.verdict === 'BLOCKED' && Array.isArray(value.findings) ? value.findings : undefined;
  if (value.verdict === 'BLOCKED' && rawFindings === undefined) {
    return { ok: false, field: 'findings', requirement: 'an array of blocking findings is required' };
  }
  const providerFindings = rawFindings?.map((finding: unknown, index: number) => {
    if (!isRecord(finding) || typeof finding.id !== 'string' || finding.id.length === 0) {
      return { error: { ok: false as const, field: `findings[${index}].id`, requirement: 'an engine-stamped finding id is required' } };
    }
    const { id: _id, ...providerFinding } = finding;
    return { providerFinding };
  });
  const badFinding = providerFindings?.find((entry) => 'error' in entry);
  if (badFinding !== undefined && 'error' in badFinding) return badFinding.error!;
  const providerValue = rawFindings === undefined
    ? value
    : { ...value, findings: providerFindings!.map((entry) => ('providerFinding' in entry ? entry.providerFinding : undefined)) };
  const checked = validateAsBuiltVerdict(providerValue);
  if (!checked.ok) return checked;
  const stamped = stampAsBuiltFindingIds(checked.verdict, attemptId);
  if (stamped.verdict === 'BLOCKED' && rawFindings !== undefined) {
    for (const [index, finding] of stamped.findings.entries()) {
      if ((rawFindings[index] as Record<string, unknown>).id !== finding.id) {
        return { ok: false, field: `findings[${index}].id`, requirement: 'the engine-stamped id must match the persisted attempt and ordinal' };
      }
    }
  }
  return { ok: true, verdict: stamped };
}

function renderReference(reference: AsBuiltGoverningReference | undefined): string {
  if (reference === undefined) return 'none';
  return reference.kind === 'adr-decision'
    ? `${reference.stem} decision ${reference.decision}`
    : `plan task ${reference.taskId}`;
}

/** Render a human-readable view. No engine reader may treat this text as authority. */
export function renderAsBuiltReport(value: PersistedAsBuiltVerdict): string {
  const { verdict, policy } = value;
  const lines = [
    '# As-built architecture review',
    '',
    `Verdict: ${verdict.verdict}`,
    `Attempt: ${value.attemptId}`,
    `Code stamp: ${value.codeStamp ?? 'unavailable'}`,
    '',
    '## Applied check policy',
    ...AS_BUILT_CHECKS.map((check) => `- ${check}: ${policy[check].enabled ? 'on' : 'off'} — ${policy[check].reason}`),
  ];
  if (verdict.reachability.length > 0) {
    lines.push('', '## Production reachability', ...verdict.reachability.map((entry) => `- ${entry.primitive}: ${entry.callerChain.length > 0 ? entry.callerChain.join(' -> ') : 'no production caller (unreachable)'}`));
  }
  if (verdict.driftNotes.length > 0) {
    lines.push('', '## Drift notes', ...verdict.driftNotes.map((note) =>
      `- ${note.note}${note.unexercised ? ` (UNEXERCISED ${note.unexercised.primitive}: ${note.unexercised.signature})` : ''}`));
  }
  if (verdict.verdict === 'PLAN_GAP') {
    lines.push('', '## Plan gap', `Outcome delivered: ${verdict.outcomeDelivered ? 'yes' : 'no'}`, `Affected outcome: ${verdict.affectedOutcome}`);
  }
  if (verdict.verdict === 'BLOCKED') {
    lines.push('', '## Blocking Findings', '| Finding | Class | Governing clause | Summary |', '| --- | --- | --- | --- |', ...verdict.findings.map((finding) =>
      `| ${finding.id} | ${finding.class} | ${renderReference(finding.reference)} | ${finding.summary} |`),
    '', '## Violations', verdict.violations, '', '## Resolution', verdict.resolution);
  }
  if (value.recordedFindings.length > 0) {
    lines.push('', '## Recorded remediation findings', ...value.recordedFindings.map((finding) =>
      `- ${finding.id} [${finding.class}] (${renderReference(finding.reference)}): ${finding.summary} — ${finding.outcome}`));
  }
  return `${lines.join('\n')}\n`;
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, 'utf8');
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function persistAsBuiltVerdict(
  worktree: string,
  verdict: AsBuiltProviderVerdict | AsBuiltVerdict,
  input: { readonly attemptId: string; readonly codeStamp: string | null; readonly policy: AsBuiltPolicy; readonly recordedFindings?: readonly RecordedAsBuiltFinding[] },
): Promise<PersistedAsBuiltVerdict> {
  // Persistence is the final authority boundary. Stamp here as well as at
  // dispatch validation so every writer, including recovery paths, records
  // only attempt-qualified identities.
  const stampedVerdict = stampAsBuiltFindingIds(verdict, input.attemptId);
  const value: PersistedAsBuiltVerdict = {
    attemptId: input.attemptId,
    codeStamp: input.codeStamp,
    verdict: stampedVerdict,
    policy: input.policy,
    recordedFindings: input.recordedFindings ?? [],
  };
  await atomicWrite(join(worktree, AS_BUILT_VERDICT_PATH), `${JSON.stringify(value, null, 2)}\n`);
  await atomicWrite(join(worktree, AS_BUILT_REPORT_PATH), renderAsBuiltReport(value));
  return value;
}

/** The sole authority reader for as-built verdict consumers. */
export async function readAsBuiltVerdict(worktree: string): Promise<ReadAsBuiltVerdictResult> {
  const path = join(worktree, AS_BUILT_VERDICT_PATH);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT'
      ? { kind: 'absent' }
      : { kind: 'unreadable', reason: `${AS_BUILT_VERDICT_PATH} is unreadable: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!isRecord(raw) || typeof raw.attemptId !== 'string' || raw.attemptId.length === 0 ||
    (raw.codeStamp !== null && typeof raw.codeStamp !== 'string') || !validPolicy(raw.policy) || !Array.isArray(raw.recordedFindings)) {
    return { kind: 'unreadable', reason: `${AS_BUILT_VERDICT_PATH} has an invalid persisted envelope` };
  }
  // D1.2: a prior contract is stale evidence. Reading it must be side-effect
  // free so only the next reviewer dispatch can author the replacement v2 verdict.
  if (isPriorAsBuiltVerdict(raw.verdict)) return { kind: 'prior-version', version: 'v1' };
  const checked = validatePersistedAsBuiltVerdict(raw.verdict, raw.attemptId);
  if (!checked.ok) return { kind: 'unreadable', reason: `${AS_BUILT_VERDICT_PATH} has invalid verdict field ${checked.field}: ${checked.requirement}` };
  if (!raw.recordedFindings.every(validRecordedFinding)) {
    return { kind: 'unreadable', reason: `${AS_BUILT_VERDICT_PATH} has invalid recorded findings` };
  }
  return { kind: 'present', value: { attemptId: raw.attemptId, codeStamp: raw.codeStamp, verdict: checked.verdict, policy: raw.policy, recordedFindings: raw.recordedFindings } };
}

/** Non-clean typed verdicts require operator review; unreadable authority fails closed. */
export function asBuiltVerdictRequiresReview(verdict: AsBuiltVerdict): boolean {
  return verdict.verdict !== 'APPROVED';
}

export async function asBuiltReviewRequired(worktree: string): Promise<boolean> {
  const stored = await readAsBuiltVerdict(worktree);
  return stored.kind !== 'present' || asBuiltVerdictRequiresReview(stored.value.verdict);
}

export function asBuiltOutcome(verdict: AsBuiltVerdict):
  | 'approved' | 'plan-gap-delivered' | 'plan-gap-undelivered' | 'blocked-remediable' | 'blocked-design' {
  switch (verdict.verdict) {
    case 'APPROVED':
    case 'APPROVED WITH DRIFT NOTES': return 'approved';
    case 'PLAN_GAP': return verdict.outcomeDelivered ? 'plan-gap-delivered' : 'plan-gap-undelivered';
    case 'BLOCKED': return verdict.findings.some((finding) => finding.class === 'DESIGN') ? 'blocked-design' : 'blocked-remediable';
  }
}

export function asBuiltFindingDetail(findings: readonly AsBuiltFinding[]): string {
  return findings.map((finding) => `${finding.id} (${finding.class}; ${renderReference(finding.reference)}): ${finding.summary}`).join('; ');
}

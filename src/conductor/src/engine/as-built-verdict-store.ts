import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  AS_BUILT_VERDICT_CONTRACT_VERSION,
  validateAsBuiltVerdict,
  type AsBuiltFinding,
  type AsBuiltGoverningReference,
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
  if (value.reference === undefined) return true;
  const probe = validateAsBuiltVerdict({
    version: AS_BUILT_VERDICT_CONTRACT_VERSION,
    verdict: 'BLOCKED', reachability: [], driftNotes: [],
    findings: [{ id: value.id, class: value.class, reference: value.reference, summary: value.summary }],
    violations: 'recorded finding validation', resolution: 'recorded finding validation',
  });
  return probe.ok;
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
    lines.push('', '## Production reachability', ...verdict.reachability.map((entry) => `- ${entry.primitive}: ${entry.callerChain.join(' -> ')}`));
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
  verdict: AsBuiltVerdict,
  input: { readonly attemptId: string; readonly codeStamp: string | null; readonly policy: AsBuiltPolicy; readonly recordedFindings?: readonly RecordedAsBuiltFinding[] },
): Promise<PersistedAsBuiltVerdict> {
  const value: PersistedAsBuiltVerdict = {
    attemptId: input.attemptId,
    codeStamp: input.codeStamp,
    verdict,
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
  const checked = validateAsBuiltVerdict(raw.verdict);
  if (!checked.ok) return { kind: 'unreadable', reason: `${AS_BUILT_VERDICT_PATH} has invalid verdict field ${checked.field}: ${checked.requirement}` };
  if (!raw.recordedFindings.every(validRecordedFinding)) {
    return { kind: 'unreadable', reason: `${AS_BUILT_VERDICT_PATH} has invalid recorded findings` };
  }
  return { kind: 'present', value: { attemptId: raw.attemptId, codeStamp: raw.codeStamp, verdict: checked.verdict, policy: raw.policy, recordedFindings: raw.recordedFindings } };
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

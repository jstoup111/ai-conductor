// self-host/version-gate.ts — VersionApprovalGate (TR-7).
//
// CLAUDE.md requires the operator to approve the semver bump before a PR opens.
// In the daemon's `auto` mode there is no prompt, so a self-build HALTs unless
// the operator has RECORDED the approved bump in `.pipeline/version-approval` and
// it matches the repo's VERSION. The daemon never invents a bump.

import { join } from 'node:path';
import { firstNonEmptyLine, writeSelfHostHalt, type GateVerdict } from './gate-halt.js';

/** Where the operator records the approved VERSION bump for a self-build. */
export const VERSION_APPROVAL_MARKER = '.pipeline/version-approval';

export interface VersionApprovalInput {
  /** Contents of the approval marker, or null when absent. */
  approvalMarker: string | null;
  /** Contents of the repo VERSION file. */
  repoVersion: string;
}

/**
 * Pure decision. Pass only when the operator recorded an approved version that
 * matches the repo VERSION. An absent / blank marker HALTs (approval required);
 * a mismatch HALTs naming both versions — never opens a PR with an unapproved
 * bump. Each reason is distinct from a rebase HALT.
 */
export function evaluateVersionApproval(input: VersionApprovalInput): GateVerdict {
  const approved = firstNonEmptyLine(input.approvalMarker);
  if (approved === null) {
    return {
      ok: false,
      reason:
        'VERSION-bump approval required (self-host version gate) — record the approved bump ' +
        `in ${VERSION_APPROVAL_MARKER}, then resume. The daemon does not invent a version.`,
    };
  }
  const repo = firstNonEmptyLine(input.repoVersion) ?? '';
  if (approved !== repo) {
    return {
      ok: false,
      reason:
        `VERSION-bump approval mismatch (self-host version gate) — approved "${approved}" but ` +
        `VERSION is "${repo}". Reconcile the bump, then resume.`,
    };
  }
  return { ok: true };
}

export interface VersionGateOptions {
  projectRoot: string;
  harnessRoot: string;
  /** Read a file's text, or null when it does not exist. */
  readText: (path: string) => Promise<string | null>;
  /** HALT writer (defaults to the shared self-host HALT). */
  writeHalt?: (projectRoot: string, reason: string) => Promise<void>;
}

/**
 * Read the approval marker + VERSION, evaluate the gate, and on failure write
 * the HALT (so the finish flow stops before opening a PR). Returns the verdict;
 * the caller must NOT open a PR when `verdict.ok` is false.
 */
export async function runVersionApprovalGate(opts: VersionGateOptions): Promise<GateVerdict> {
  const writeHalt = opts.writeHalt ?? writeSelfHostHalt;
  const approvalMarker = await opts.readText(join(opts.projectRoot, VERSION_APPROVAL_MARKER));
  const repoVersion = (await opts.readText(join(opts.harnessRoot, 'VERSION'))) ?? '';
  const verdict = evaluateVersionApproval({ approvalMarker, repoVersion });
  if (!verdict.ok) await writeHalt(opts.projectRoot, verdict.reason);
  return verdict;
}

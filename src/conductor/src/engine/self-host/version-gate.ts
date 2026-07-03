// self-host/version-gate.ts — VersionApprovalGate (TR-7).
//
// CLAUDE.md requires the operator to approve the semver bump before a PR opens.
// In the daemon's `auto` mode there is no prompt, so a self-build HALTs unless
// the operator has RECORDED the approved bump in `.pipeline/version-approval` and
// it matches the repo's VERSION. The daemon never invents a bump.
//
// Version freeze (#261): during a declared freeze (`harness_self_host.
// version_freeze` naming the current version) the operator's approval decision
// is deterministic — "the current version, no bump" — so the gate self-satisfies
// by recording that standing approval instead of halting every self-build. A
// freeze NEVER approves an actual bump: any VERSION differing from the frozen
// value halts exactly as before.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { firstNonEmptyLine, writeSelfHostHalt, type GateVerdict } from './gate-halt.js';

/** Where the operator records the approved VERSION bump for a self-build. */
export const VERSION_APPROVAL_MARKER = '.pipeline/version-approval';

export interface VersionApprovalInput {
  /** Contents of the approval marker, or null when absent. */
  approvalMarker: string | null;
  /** Contents of the repo VERSION file. */
  repoVersion: string;
  /** Declared version freeze (`harness_self_host.version_freeze`), or null. */
  versionFreeze?: string | null;
}

/**
 * Pure decision. Pass when the operator recorded an approved version that
 * matches the repo VERSION, or — with the marker absent — when a declared
 * freeze matches the repo VERSION (the standing "no bump" approval). An
 * explicit marker always wins over the freeze. An absent / blank marker with
 * no matching freeze HALTs (approval required); a mismatch HALTs naming both
 * versions — never opens a PR with an unapproved bump. Each reason is distinct
 * from a rebase HALT.
 */
export function evaluateVersionApproval(input: VersionApprovalInput): GateVerdict {
  const approved = firstNonEmptyLine(input.approvalMarker);
  const repo = firstNonEmptyLine(input.repoVersion) ?? '';
  if (approved === null) {
    const freeze = firstNonEmptyLine(input.versionFreeze);
    if (freeze !== null) {
      if (freeze === repo) return { ok: true };
      return {
        ok: false,
        reason:
          `VERSION-bump approval required (self-host version gate) — version_freeze is ` +
          `"${freeze}" but VERSION is "${repo}"; a freeze never approves a bump. Record the ` +
          `approved bump in ${VERSION_APPROVAL_MARKER} (or update the freeze), then resume.`,
      };
    }
    return {
      ok: false,
      reason:
        'VERSION-bump approval required (self-host version gate) — record the approved bump ' +
        `in ${VERSION_APPROVAL_MARKER}, then resume. The daemon does not invent a version.`,
    };
  }
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
  /** Declared version freeze (`harness_self_host.version_freeze`), or null. */
  versionFreeze?: string | null;
  /** HALT writer (defaults to the shared self-host HALT). */
  writeHalt?: (projectRoot: string, reason: string) => Promise<void>;
  /** Marker writer for a freeze auto-approval (defaults to fs writeFile). */
  writeText?: (path: string, content: string) => Promise<void>;
}

/**
 * Read the approval marker + VERSION, evaluate the gate, and on failure write
 * the HALT (so the finish flow stops before opening a PR). When a freeze
 * auto-approves (marker absent, freeze === VERSION), the standing approval is
 * recorded to the marker best-effort — the audit trail of WHY the PR opened.
 * Returns the verdict; the caller must NOT open a PR when `verdict.ok` is false.
 */
export async function runVersionApprovalGate(opts: VersionGateOptions): Promise<GateVerdict> {
  const writeHalt = opts.writeHalt ?? writeSelfHostHalt;
  const writeText = opts.writeText ?? ((p: string, c: string) => writeFile(p, c, 'utf-8'));
  const markerPath = join(opts.projectRoot, VERSION_APPROVAL_MARKER);
  const approvalMarker = await opts.readText(markerPath);
  const repoVersion = (await opts.readText(join(opts.harnessRoot, 'VERSION'))) ?? '';
  const verdict = evaluateVersionApproval({
    approvalMarker,
    repoVersion,
    versionFreeze: opts.versionFreeze ?? null,
  });
  if (!verdict.ok) {
    await writeHalt(opts.projectRoot, verdict.reason);
    return verdict;
  }
  if (firstNonEmptyLine(approvalMarker) === null) {
    // Freeze auto-approval: record the standing decision. Best-effort — the
    // marker is evidence, not a precondition the gate re-requires.
    const frozen = firstNonEmptyLine(opts.versionFreeze) ?? '';
    try {
      await writeText(markerPath, `${frozen}\n`);
    } catch {
      // A failed evidence write must not fail an approved gate.
    }
  }
  return verdict;
}

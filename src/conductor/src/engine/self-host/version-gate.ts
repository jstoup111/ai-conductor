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
//
// Marker invariance (Task 10): The presence and match status of the approval marker
// is INDEPENDENT of change-set classification:
// - marker == VERSION: approval is granted (short-circuit, classifier NEVER invoked)
// - marker ≠ VERSION: mismatch is fatal (cannot be rescued by a good signal)
// - marker absent: classification is consulted ONLY here (Task 11 implementation)
// The marker path logic remains byte-identical to the original implementation.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { firstNonEmptyLine, writeSelfHostHalt, type GateVerdict } from './gate-halt.js';
import type { VersionSignal } from './version-signal.js';

/** Where the operator records the approved VERSION bump for a self-build. */
export const VERSION_APPROVAL_MARKER = '.pipeline/version-approval';

export interface VersionApprovalInput {
  /** Contents of the approval marker, or null when absent. */
  approvalMarker: string | null;
  /** Contents of the repo VERSION file. */
  repoVersion: string;
  /** Declared version freeze (`harness_self_host.version_freeze`), or null. */
  versionFreeze?: string | null;
  /** Optional signal to escalate classification on absent marker (Task 11). */
  signal?: VersionSignal;
  /** Optional spy/mock classifier for testing (consulted only on absent marker). */
  classifier?: (signal?: VersionSignal) => void;
}

/**
 * Pure decision. Pass when the operator recorded an approved version that
 * matches the repo VERSION, or — with the marker absent — when a declared
 * freeze matches the repo VERSION (the standing "no bump" approval). An
 * explicit marker always wins over the freeze. An absent / blank marker with
 * no matching freeze HALTs (approval required); a mismatch HALTs naming both
 * versions — never opens a PR with an unapproved bump. Each reason is distinct
 * from a rebase HALT.
 *
 * Task 11: When marker is absent and freeze does not apply, consult the
 * optional signal parameter to classify the change set:
 * - PATCH: auto-pass (verdict ok)
 * - MINOR/MAJOR: HALT with informative reason (level, paths, resume procedure)
 * - undeterminable: HALT with undeterminable message
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

    // Task 11: No freeze; consult signal classification for no-marker escalation
    if (input.signal) {
      // Invoke classifier spy if provided (for testing marker invariance)
      input.classifier?.(input.signal);

      if (input.signal.level === 'patch') {
        // PATCH auto-pass: all changes are safe
        return { ok: true };
      }

      if (input.signal.level === 'minor' || input.signal.level === 'major') {
        // MINOR/MAJOR: halt with informative reason
        const signals = input.signal.signals ?? [];
        const filesList = signals
          .flatMap(s => s.files)
          .map(f => `  - ${f}`)
          .join('\n');
        const levelName = input.signal.level.toUpperCase();
        return {
          ok: false,
          reason:
            `VERSION-bump approval escalated (self-host version gate) — change set signals ${levelName}:\n` +
            (filesList ? `${filesList}\n` : '') +
            `To approve this bump, record the new version in ${VERSION_APPROVAL_MARKER} and re-run the daemon.`,
        };
      }

      if (input.signal.level === 'halt-undeterminable') {
        // Undeterminable: cannot safely classify
        return {
          ok: false,
          reason:
            `VERSION-bump approval undeterminable (self-host version gate) — ${input.signal.reason} ` +
            `To proceed, record the approved version in ${VERSION_APPROVAL_MARKER} and re-run the daemon.`,
        };
      }
    }

    // Fallback: no signal provided, no freeze, marker absent
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
  /** Optional signal to escalate classification on absent marker (Task 11). */
  signal?: VersionSignal;
  /** Audit record writer for PATCH auto-pass (defaults to fs writeFile). */
  writeAudit?: (path: string, content: string) => Promise<void>;
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

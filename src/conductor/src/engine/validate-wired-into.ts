/**
 * DECIDE-time validation of a plan's `**Wired-into:**` anchors.
 *
 * The wiring contract is checked twice at BUILD time — by per-task completion
 * verification and again by the `wiring_check` step — and both go through
 * `verifyDeclaredSites`. Until this module existed, nothing checked the
 * anchors at *authoring* time, so an anchor form that never resolved produced
 * no error at all: the build simply never advanced a task past `pending`.
 * That failure mode is real (a 19-task plan spun for hours at 0/19 completed
 * while ~25 substantive commits landed).
 *
 * This module closes that gap by running the SAME machinery the build runs,
 * against the plan text, before the plan is approved. It deliberately owns
 * NO matching logic of its own: parsing/inheritance come from `wired-into.ts`
 * (`extractWiredIntoContracts`, which resolves `same as Task N` via
 * `resolveWiredInto`/`combineWiredInto`), and the symbol-reference check
 * comes from `wiring-probe.ts`'s `verifyDeclaredSites`. Duplicating either
 * would reintroduce exactly the drift this validator exists to prevent — if
 * BUILD-time verification changes what "valid" means, this validator changes
 * with it for free.
 */

import { extractWiredIntoContracts, type WiredIntoParseResult } from './wired-into.js';
import { verifyDeclaredSites, type FileReader } from './wiring-probe.js';

/** `pass` — every declared site verified; `fail` — blocking; `skip` — a `none (...)` waiver form. */
export type WiredIntoValidationStatus = 'pass' | 'fail' | 'skip';

/** The declared form a task's (possibly inherited) contract resolved to. */
export type WiredIntoValidationForm = WiredIntoParseResult['kind'];

export interface WiredIntoValidationRow {
  /** Bare task id as it appears in the plan's task header. */
  taskId: string;
  status: WiredIntoValidationStatus;
  form: WiredIntoValidationForm;
  /** Verbatim evidence (pass) or the verbatim gap/parse message (fail). */
  detail: string;
}

export interface WiredIntoValidationResult {
  rows: WiredIntoValidationRow[];
  /** False when any row failed — the caller's non-zero exit signal. */
  ok: boolean;
}

/**
 * Validate every task's `**Wired-into:**` contract in `planText`.
 *
 * Tasks with no `**Wired-into:**` line at all produce no row (that absence is
 * `/plan`'s own presence checklist item, not an anchor-resolution question).
 * A `declared` contract with zero sites is a failure, not a vacuous pass: an
 * empty declaration would otherwise sail through `verifyDeclaredSites`, which
 * has nothing to check.
 */
export async function validateWiredIntoPlan(
  planText: string,
  readFile: FileReader,
): Promise<WiredIntoValidationResult> {
  const rows: WiredIntoValidationRow[] = [];

  for (const [taskId, contract] of extractWiredIntoContracts(planText)) {
    rows.push(await validateContract(taskId, contract, readFile));
  }

  return { rows, ok: rows.every((row) => row.status !== 'fail') };
}

async function validateContract(
  taskId: string,
  contract: WiredIntoParseResult,
  readFile: FileReader,
): Promise<WiredIntoValidationRow> {
  switch (contract.kind) {
    case 'malformed':
      return { taskId, status: 'fail', form: 'malformed', detail: contract.message };

    case 'no_new_surface':
      return {
        taskId,
        status: 'skip',
        form: 'no_new_surface',
        detail: 'none (no new production surface) — no anchor to resolve',
      };

    case 'inert': {
      const ref =
        contract.ref.form === 'issue'
          ? `${contract.ref.owner}/${contract.ref.repo}#${contract.ref.number}`
          : contract.ref.path;
      return {
        taskId,
        status: 'skip',
        form: 'inert',
        detail: `none (inert until ${ref}) — deferred, no anchor to resolve yet`,
      };
    }

    case 'declared': {
      if (contract.sites.length === 0) {
        return {
          taskId,
          status: 'fail',
          form: 'declared',
          detail:
            '**Wired-into:** line present but declares no declared call site — ' +
            'give a `path#symbol` anchor, `same as Task N`, or a `none (...)` form',
        };
      }

      // The build-time check, verbatim. `newExports` is not consulted by
      // verifyDeclaredSites' literal-reference layer, and at authoring time
      // no diff exists to derive it from — so an empty list is honest here,
      // not a stub.
      const { gaps, evidence } = await verifyDeclaredSites(contract.sites, [], readFile);

      if (gaps.length > 0) {
        return { taskId, status: 'fail', form: 'declared', detail: gaps.join('; ') };
      }

      return {
        taskId,
        status: 'pass',
        form: 'declared',
        detail: evidence.map((e) => `${e.site} → ${e.matchedLine}`).join('; '),
      };
    }
  }
}

const STATUS_LABEL: Record<WiredIntoValidationStatus, string> = {
  pass: 'PASS',
  fail: 'FAIL',
  skip: 'SKIP',
};

/**
 * Render the per-task report. Written for a human or an LLM authoring a plan:
 * one line per task, the verdict first, and a trailing count that names the
 * number of blocking failures.
 */
export function renderWiredIntoValidationReport(
  result: WiredIntoValidationResult,
  planPath: string,
): string {
  const lines = [`validate-wired-into: ${planPath}`];

  if (result.rows.length === 0) {
    lines.push('  (no **Wired-into:** declarations found — nothing to validate)');
    return lines.join('\n');
  }

  for (const row of result.rows) {
    lines.push(`  ${STATUS_LABEL[row.status]}  Task ${row.taskId}  [${row.form}]  ${row.detail}`);
  }

  const failures = result.rows.filter((row) => row.status === 'fail').length;
  const plural = result.rows.length === 1 ? '' : 's';
  lines.push(
    failures === 0
      ? `${result.rows.length} declaration${plural} checked — 0 FAIL`
      : `${result.rows.length} declaration${plural} checked — ${failures} FAIL (blocking: fix the anchor, or escalate if it should be valid)`,
  );

  return lines.join('\n');
}

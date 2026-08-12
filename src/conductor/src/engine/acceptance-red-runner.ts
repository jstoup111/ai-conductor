import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ACCEPTANCE_SPECS_RED_EVIDENCE, validateAcceptanceRedEvidence } from "./artifacts.js";

const execFileAsync = promisify(execFile);

/**
 * Relative path (from the worktree root) to the acceptance run contract
 * written by the acceptance_specs step, describing the command/cwd/target
 * specs the RED run must execute.
 */
const ACCEPTANCE_RUN_CONTRACT_PATH = join(".pipeline", "acceptance-specs-run.json");

export interface AcceptanceRunContract {
  command: string;
  cwd: string;
  targetSpecs: string[];
}

export type ParseAcceptanceRunContractResult =
  | { ok: true; contract: AcceptanceRunContract }
  | { ok: false; reason: string };

function parseAcceptanceRunContract(
  raw: string,
): ParseAcceptanceRunContractResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid run contract JSON" };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "contract must be an object" };
  }

  const candidate = parsed as Record<string, unknown>;

  if (typeof candidate.command !== "string" || candidate.command.length === 0) {
    return { ok: false, reason: "missing command" };
  }

  if (typeof candidate.cwd !== "string" || candidate.cwd.length === 0) {
    return { ok: false, reason: "missing cwd" };
  }

  if (
    !Array.isArray(candidate.targetSpecs) ||
    candidate.targetSpecs.length === 0 ||
    !candidate.targetSpecs.every((spec) => typeof spec === "string")
  ) {
    return { ok: false, reason: "targetSpecs must be a non-empty string array" };
  }

  return {
    ok: true,
    contract: {
      command: candidate.command,
      cwd: candidate.cwd,
      targetSpecs: candidate.targetSpecs,
    },
  };
}

export type CrossCheckTargetSpecsResult =
  | { ok: true; contract: AcceptanceRunContract }
  | { ok: false; reason: string };

function crossCheckTargetSpecs(
  contract: AcceptanceRunContract,
  globbedSpecFiles: string[],
): CrossCheckTargetSpecsResult {
  const committed = new Set(globbedSpecFiles);
  const missing = contract.targetSpecs.filter((spec) => !committed.has(spec));

  if (missing.length > 0) {
    return {
      ok: false,
      reason: `targetSpecs [${missing.join(", ")}] not among committed specs`,
    };
  }

  return { ok: true, contract };
}

export type CheckContractCwdResult =
  | { ok: true; contract: AcceptanceRunContract }
  | { ok: false; reason: string };

function checkContractCwd(
  contract: AcceptanceRunContract,
  worktreeRoot: string,
): CheckContractCwdResult {
  const resolvedRoot = resolve(worktreeRoot);
  const resolvedCwd = resolve(resolvedRoot, contract.cwd);
  const withinRoot =
    resolvedCwd === resolvedRoot ||
    resolvedCwd.startsWith(resolvedRoot + sep);

  if (!withinRoot || !existsSync(resolvedCwd)) {
    return { ok: false, reason: `contract cwd not found: ${contract.cwd}` };
  }

  return { ok: true, contract };
}

/**
 * Writes the RED evidence marker at the authoritative worktree-root path,
 * `<worktreeRoot>/.pipeline/acceptance-specs-red.json`, regardless of the
 * cwd the acceptance run itself executed in. This guarantees the marker
 * never lands nested under a subdirectory (e.g. `<worktreeRoot>/src/conductor/.pipeline/`),
 * which is where the daemon's evidence check would fail to find it.
 */
function writeRedMarkerAtRoot(
  worktreeRoot: string,
  markerContent: unknown,
): void {
  const markerPath = join(resolve(worktreeRoot), ACCEPTANCE_SPECS_RED_EVIDENCE);
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, JSON.stringify(markerContent), "utf8");
}

/**
 * Retrieves the operator-recorded exception from the prior root marker. The
 * self-heal owns observed run results, not this declaration, so a re-run must
 * retain it exactly as recorded. An unreadable or non-object prior marker has
 * no declaration to carry forward.
 */
function readRecordedException(
  worktreeRoot: string,
): { hasException: boolean; exception?: unknown } {
  const markerPath = join(resolve(worktreeRoot), ACCEPTANCE_SPECS_RED_EVIDENCE);
  if (!existsSync(markerPath)) {
    return { hasException: false };
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(markerPath, "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.prototype.hasOwnProperty.call(parsed, "exception")
    ) {
      return {
        hasException: true,
        exception: (parsed as Record<string, unknown>).exception,
      };
    }
  } catch {
    // The fresh run can still recover an unreadable prior marker; it simply
    // has no trustworthy declaration to preserve.
  }

  return { hasException: false };
}

function hasExtractableFailingTestDetail(marker: Record<string, unknown>): boolean {
  return (
    Array.isArray(marker.failingTests) &&
    marker.failingTests.length > 0 &&
    marker.failingTests.every((test) => {
      if (typeof test !== "object" || test === null) return false;
      const detail = test as Record<string, unknown>;
      return (
        typeof detail.name === "string" &&
        detail.name.trim() !== "" &&
        typeof detail.reason === "string" &&
        detail.reason.trim() !== ""
      );
    })
  );
}

function establishedRedCounters(marker: Record<string, unknown>): boolean {
  return (
    typeof marker.executed === "number" &&
    marker.executed >= 1 &&
    typeof marker.failed === "number" &&
    marker.failed >= 1 &&
    marker.skipped === 0 &&
    marker.errors === 0
  );
}

/**
 * Known nested location a RED marker can stray into when an acceptance run's
 * contract.cwd points at a subdirectory (e.g. `src/conductor`) instead of the
 * worktree root.
 */
const NESTED_RED_MARKER_RELATIVE_PATH = join(
  "src",
  "conductor",
  ACCEPTANCE_SPECS_RED_EVIDENCE,
);

/**
 * Relocates a stray RED marker found nested under `<worktreeRoot>/src/conductor/`
 * up to the authoritative root path, `<worktreeRoot>/.pipeline/acceptance-specs-red.json`.
 *
 * The root marker always wins: if one already exists there, it is left
 * untouched and the nested marker is never read into it — a nested marker is
 * only ever promoted to root when no root marker exists yet.
 */
function normalizeNestedRedMarker(worktreeRoot: string): void {
  const resolvedRoot = resolve(worktreeRoot);
  const rootPath = join(resolvedRoot, ACCEPTANCE_SPECS_RED_EVIDENCE);
  const nestedPath = join(resolvedRoot, NESTED_RED_MARKER_RELATIVE_PATH);

  if (!existsSync(nestedPath)) {
    return;
  }

  if (existsSync(rootPath)) {
    return;
  }

  const nestedContent = readFileSync(nestedPath, "utf8");
  mkdirSync(dirname(rootPath), { recursive: true });
  writeFileSync(rootPath, nestedContent, "utf8");
  rmSync(nestedPath, { force: true });
}

/**
 * Injected command runner for {@link selfHealAcceptanceRed}. Implementations
 * actually execute `command` in `cwd` and return a RED-marker-shaped result
 * (the same shape {@link validateAcceptanceRedEvidence} validates) describing
 * what happened — it does NOT write the marker itself; the orchestrator is
 * responsible for persisting it at the authoritative root path.
 */
export type AcceptanceRedExec = (
  command: string,
  opts: { cwd: string },
) => Promise<unknown>;

export type AcceptanceRedCommandRunner = (
  command: string,
  cwd: string,
) => Promise<{ stdout: string; stderr?: string }>;

export type ProductionAcceptanceRedExec = (
  command: string,
  cwd: string,
) => Promise<unknown>;

const ACCEPTANCE_RED_EVIDENCE_PREFIX = "ACCEPTANCE_RED_EVIDENCE: ";

function parseAcceptanceRedOutput(stdout: string): Record<string, unknown> {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const evidenceLines = lines.filter((line) => line.startsWith(ACCEPTANCE_RED_EVIDENCE_PREFIX));
  if (evidenceLines.length !== 1 || lines.at(-1) !== evidenceLines[0]) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(
      evidenceLines[0].slice(ACCEPTANCE_RED_EVIDENCE_PREFIX.length),
    );
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // The final evidence line was malformed; preserve the prior marker.
  }
  return {};
}

async function runProductionAcceptanceCommand(
  command: string,
  cwd: string,
): Promise<{ stdout: string; stderr?: string }> {
  try {
    const result = await execFileAsync(command, { cwd, shell: true } as any);
    return { stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
  } catch (error) {
    const result = error as { stdout?: unknown; stderr?: unknown };
    return { stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
  }
}

/**
 * Production adapter for the exact command recorded in the run contract.
 * The command emits one final `ACCEPTANCE_RED_EVIDENCE: <JSON>` line carrying
 * observed counters and provenance; ordinary diagnostics may precede it.
 */
export function createProductionAcceptanceRedExec(
  runCommand: AcceptanceRedCommandRunner = runProductionAcceptanceCommand,
): ProductionAcceptanceRedExec {
  return async (command, cwd) => {
    const result = await runCommand(command, cwd);
    return parseAcceptanceRedOutput(result.stdout);
  };
}

export interface SelfHealAcceptanceRedParams {
  worktree: string;
  specFiles: string[];
  exec: AcceptanceRedExec;
}

export type SelfHealAcceptanceRedResult =
  | { healed: true }
  | { healed: false; reason: string };

/**
 * Orchestrates a self-healing RED-evidence run: first relocates any stray
 * marker left nested from a PRIOR run up to the authoritative root path,
 * then reads and validates the acceptance run contract, cross-checks it
 * against the feature's committed spec files, guards its cwd, executes it
 * via the injected `exec`, validates the fresh result, then replaces the root
 * marker only when that complete provenance-bearing result passes validation.
 * A malformed command result leaves any prior evidence intact.
 *
 * Any guard failure (parse/cross-check/cwd) short-circuits before `exec` is
 * ever called.
 */
export async function selfHealAcceptanceRed(
  params: SelfHealAcceptanceRedParams,
): Promise<SelfHealAcceptanceRedResult> {
  const { worktree, specFiles, exec } = params;
  const resolvedRoot = resolve(worktree);

  const contractPath = join(resolvedRoot, ACCEPTANCE_RUN_CONTRACT_PATH);

  if (!existsSync(contractPath)) {
    // With no contract to validate against, we cannot safely promote a
    // stray nested marker to the authoritative root path — doing so would
    // fabricate root evidence for a run we never actually executed or
    // cross-checked. Surface a specific "not at the authoritative path"
    // diagnostic instead of silently promoting, and never touch the nested
    // file in this branch.
    const rootMarkerPath = join(resolvedRoot, ACCEPTANCE_SPECS_RED_EVIDENCE);
    const nestedMarkerPath = join(resolvedRoot, NESTED_RED_MARKER_RELATIVE_PATH);
    if (!existsSync(rootMarkerPath) && existsSync(nestedMarkerPath)) {
      return {
        healed: false,
        reason:
          `${ACCEPTANCE_SPECS_RED_EVIDENCE} found nested at ${nestedMarkerPath}, ` +
          `not at the authoritative path ${rootMarkerPath}; run contract missing: ${contractPath}`,
      };
    }
    return { healed: false, reason: `run contract missing: ${contractPath}` };
  }

  // Recover any stray marker left nested from a PRIOR run before doing
  // anything else. This is independent of the current run's fresh result:
  // it only promotes a nested marker to root when no root marker already
  // exists, so it never clobbers a marker from this (or a prior) run. Only
  // reached once a contract exists, so promotion never happens blind.
  normalizeNestedRedMarker(resolvedRoot);

  const raw = readFileSync(contractPath, "utf8");
  const parsed = parseAcceptanceRunContract(raw);
  if (!parsed.ok) {
    return { healed: false, reason: parsed.reason };
  }

  const crossChecked = crossCheckTargetSpecs(parsed.contract, specFiles);
  if (!crossChecked.ok) {
    return { healed: false, reason: crossChecked.reason };
  }

  const cwdChecked = checkContractCwd(crossChecked.contract, resolvedRoot);
  if (!cwdChecked.ok) {
    return { healed: false, reason: cwdChecked.reason };
  }

  const { contract } = cwdChecked;
  const resolvedCwd = resolve(resolvedRoot, contract.cwd);
  const recordedException = readRecordedException(resolvedRoot);
  const execResult = await exec(contract.command, { cwd: resolvedCwd });

  // `validateAcceptanceRedEvidence` requires `command` and `targetSpecs` on
  // the marker itself, but the injected `exec` only returns the run's
  // executed/passed/failed/skipped/errors counters — merge the contract's
  // command/targetSpecs in so a genuinely successful RED run is never
  // rejected for a shape gap the exec result was never responsible for.
  const execMarker =
    typeof execResult === "object" && execResult !== null && !Array.isArray(execResult)
      ? (execResult as Record<string, unknown>)
      : {};
  const { exception: _execException, ...observedRun } = execMarker;
  const markerContent = {
    ...observedRun,
    command: contract.command,
    targetSpecs: contract.targetSpecs,
    ranAt: new Date().toISOString(),
    ...(recordedException.hasException
      ? { exception: recordedException.exception }
      : {}),
  };

  const validated = validateAcceptanceRedEvidence(markerContent);
  if (!validated.ok) {
    // A complete fresh observation with an unsuccessful RED outcome is still
    // useful evidence and must replace stale data. Only malformed/incomplete
    // parser output is refused without disturbing the prior marker.
    if (validated.class === "outcome") {
      writeRedMarkerAtRoot(resolvedRoot, markerContent);
      return { healed: false, reason: validated.reason };
    }
    if (
      establishedRedCounters(markerContent) &&
      !hasExtractableFailingTestDetail(markerContent)
    ) {
      return {
        healed: false,
        reason: "failing-test detail could not be extracted from the self-heal run output",
      };
    }
    return { healed: false, reason: validated.reason };
  }

  writeRedMarkerAtRoot(resolvedRoot, markerContent);
  return { healed: true };
}

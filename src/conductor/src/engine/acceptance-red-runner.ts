import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { ACCEPTANCE_SPECS_RED_EVIDENCE, validateAcceptanceRedEvidence } from "./artifacts";

/**
 * Relative path (from the worktree root) to the acceptance run contract
 * written by the acceptance_specs step, describing the command/cwd/target
 * specs the RED run must execute.
 */
export const ACCEPTANCE_RUN_CONTRACT_PATH = join(".pipeline", "acceptance-specs-run.json");

export interface AcceptanceRunContract {
  command: string;
  cwd: string;
  targetSpecs: string[];
}

export type ParseAcceptanceRunContractResult =
  | { ok: true; contract: AcceptanceRunContract }
  | { ok: false; reason: string };

export function parseAcceptanceRunContract(
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

export function crossCheckTargetSpecs(
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

export function checkContractCwd(
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
export function writeRedMarkerAtRoot(
  worktreeRoot: string,
  markerContent: unknown,
): void {
  const markerPath = join(resolve(worktreeRoot), ACCEPTANCE_SPECS_RED_EVIDENCE);
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, JSON.stringify(markerContent), "utf8");
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
export function normalizeNestedRedMarker(worktreeRoot: string): void {
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
 * via the injected `exec`, writes the fresh result at the authoritative root
 * path (unconditionally, since a freshly executed result always supersedes
 * whatever was there before), and re-validates with the existing
 * {@link validateAcceptanceRedEvidence}.
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
  const execResult = await exec(contract.command, { cwd: resolvedCwd });

  // `validateAcceptanceRedEvidence` requires `command` and `targetSpecs` on
  // the marker itself, but the injected `exec` only returns the run's
  // executed/passed/failed/skipped/errors counters — merge the contract's
  // command/targetSpecs in so a genuinely successful RED run is never
  // rejected for a shape gap the exec result was never responsible for.
  const markerContent = {
    ...(typeof execResult === 'object' && execResult !== null ? execResult : {}),
    command: contract.command,
    targetSpecs: contract.targetSpecs,
  };

  writeRedMarkerAtRoot(resolvedRoot, markerContent);

  const markerPath = join(resolvedRoot, ACCEPTANCE_SPECS_RED_EVIDENCE);
  const markerRaw = readFileSync(markerPath, "utf8");
  let markerParsed: unknown;
  try {
    markerParsed = JSON.parse(markerRaw);
  } catch {
    return { healed: false, reason: `${ACCEPTANCE_SPECS_RED_EVIDENCE} is not valid JSON` };
  }

  const validated = validateAcceptanceRedEvidence(markerParsed);
  if (!validated.ok) {
    return { healed: false, reason: validated.reason };
  }

  return { healed: true };
}

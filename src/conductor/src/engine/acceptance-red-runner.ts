import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { ACCEPTANCE_SPECS_RED_EVIDENCE } from "./artifacts";

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
    return { ok: false, reason: "invalid JSON" };
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

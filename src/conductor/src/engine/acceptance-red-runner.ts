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

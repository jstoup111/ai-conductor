export interface RoutedAcceptanceRunContract {
  readonly command: string;
  readonly cwd: string;
}

export interface RoutedRedRecord {
  readonly digest: string;
  readonly contract?: RoutedAcceptanceRunContract;
}

function parseContract(value: unknown): RoutedAcceptanceRunContract | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const contract = value as Record<string, unknown>;
  return typeof contract.command === 'string' && contract.command !== '' && typeof contract.cwd === 'string' && contract.cwd !== ''
    ? { command: contract.command, cwd: contract.cwd }
    : undefined;
}

/** Extracts the command/cwd pair that is safe to retain after a child closes. */
export function parseRoutedAcceptanceRunContract(value: unknown): RoutedAcceptanceRunContract | undefined {
  return parseContract(value);
}

/**
 * The original red ref stored only the marker digest.  New records retain that
 * digest and the executable contract together, while the parser keeps old refs
 * readable so an already-closed child never becomes invalid retroactively.
 */
export function parseRoutedRedRecord(blob: string): RoutedRedRecord | undefined {
  try {
    const value = JSON.parse(blob) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return { digest: blob.trim() };
    const record = value as Record<string, unknown>;
    const contract = parseContract(record.contract);
    return typeof record.digest === 'string' && record.digest !== '' && contract !== undefined
      ? { digest: record.digest, contract }
      : undefined;
  } catch {
    const digest = blob.trim();
    return digest === '' ? undefined : { digest };
  }
}

export function serializeRoutedRedRecord(digest: string, contract: RoutedAcceptanceRunContract | undefined): string {
  return contract === undefined ? digest : JSON.stringify({ digest, contract });
}

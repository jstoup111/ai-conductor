/** A non-transient failure to restore a project-owned region during FINISH. */
export class RegionRestoreError extends Error {
  override readonly name = 'RegionRestoreError';

  constructor(
    readonly kind: 'refused' | 'mismatch',
    readonly stepKeys: readonly string[],
    readonly guardedEditKind?: string,
    message?: string,
  ) {
    const steps = stepKeys.join(', ') || 'unknown';
    super(
      message ?? (kind === 'refused'
        ? `guarded region restore refused for ${steps}: ${guardedEditKind ?? 'unknown'}`
        : `region verification mismatch for ${steps}`),
    );
  }
}

export function isRegionRestoreError(error: unknown): error is RegionRestoreError {
  return error instanceof RegionRestoreError;
}

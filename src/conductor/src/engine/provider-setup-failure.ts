/**
 * Explicit, provider-owned evidence that setup cannot reach an invocation.
 * These diagnostics are deliberately structured: arbitrary exceptions and
 * their messages must never authorize fallback to another provider.
 */
export interface ProviderSetupUnavailable {
  provider: string;
  reason: string;
  recoveryAction: string;
  capability?: string;
}

/** An ordered, nonempty record of candidates skipped before invocation. */
export interface ProviderSetupExhaustion {
  candidates: readonly [ProviderSetupUnavailable, ...ProviderSetupUnavailable[]];
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidSetupUnavailable(value: unknown): value is ProviderSetupUnavailable {
  if (value === null || typeof value !== 'object') return false;

  const candidate = value as Partial<ProviderSetupUnavailable>;
  return (
    isNonBlankString(candidate.provider) &&
    isNonBlankString(candidate.reason) &&
    isNonBlankString(candidate.recoveryAction) &&
    (candidate.capability === undefined || isNonBlankString(candidate.capability))
  );
}

/**
 * A nominal setup-unavailability signal emitted only by verified setup
 * producers. Its private field prevents ordinary Errors and lookalike objects
 * from being normalized as fallback authority.
 */
export class ProviderSetupUnavailableError extends Error {
  readonly #providerSetupUnavailableBrand = true;

  constructor(readonly setupUnavailable: ProviderSetupUnavailable) {
    if (!isValidSetupUnavailable(setupUnavailable)) {
      throw new TypeError('Provider setup unavailability requires non-empty diagnostics.');
    }
    super(`Provider ${setupUnavailable.provider} is unavailable during setup.`);
    this.name = 'ProviderSetupUnavailableError';
  }

  static isBranded(error: unknown): error is ProviderSetupUnavailableError {
    if (!(error instanceof ProviderSetupUnavailableError)) return false;
    return error.#providerSetupUnavailableBrand === true;
  }
}

/** Identifies the nominal error signal without inspecting error-message text. */
export function isProviderSetupUnavailableError(
  error: unknown,
): error is ProviderSetupUnavailableError {
  return ProviderSetupUnavailableError.isBranded(error);
}

/**
 * Converts only a valid branded error from the candidate currently being
 * prepared. A provider mismatch or invalid diagnostic remains an ordinary
 * error for its caller's existing failure policy.
 */
export function normalizeProviderSetupUnavailable(
  error: unknown,
  provider: string,
): ProviderSetupUnavailable | undefined {
  if (
    !isProviderSetupUnavailableError(error) ||
    !isNonBlankString(provider) ||
    !isValidSetupUnavailable(error.setupUnavailable) ||
    error.setupUnavailable.provider !== provider
  ) {
    return undefined;
  }

  return error.setupUnavailable;
}

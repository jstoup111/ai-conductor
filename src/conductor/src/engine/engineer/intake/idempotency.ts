// FR-15: intake idempotency keyed strictly on (source, sourceRef).
// The dedup key is source + NUL + sourceRef. The text field is intentionally
// ignored to avoid false-positives when the same idea is re-stated under a
// different reference.

export interface IdempotencyCheckInput {
  source: string;
  sourceRef: string;
  text?: string;
}

export interface IdempotencyCheckResult {
  duplicate: boolean;
  reason?: string;
  notice?: string;
}

export interface IntakeIdempotency {
  check(input: IdempotencyCheckInput): Promise<IdempotencyCheckResult>;
}

/**
 * Creates a new intake idempotency guard with its own private seen-set.
 * Each call to createIntakeIdempotency() returns an independent instance.
 */
export function createIntakeIdempotency(): IntakeIdempotency {
  const seen = new Set<string>();

  return {
    async check({ source, sourceRef }: IdempotencyCheckInput): Promise<IdempotencyCheckResult> {
      const key = `${source}\0${sourceRef}`;

      if (seen.has(key)) {
        return {
          duplicate: true,
          reason: `duplicate: (source="${source}", sourceRef="${sourceRef}") was already processed`,
        };
      }

      seen.add(key);
      return { duplicate: false };
    },
  };
}

export const CLOSEOUT_EPOCH_FLOOR_MS = 1_577_836_800_000;
export const CLOSEOUT_FUTURE_SKEW_MS = 60_000;

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function closeoutDurationMs({
  startedAt,
  endedAt,
  ts,
}: {
  startedAt?: unknown;
  endedAt?: unknown;
  ts: unknown;
}): number | undefined {
  if (
    !isSafeInteger(startedAt)
    || !isSafeInteger(endedAt)
    || !isSafeInteger(ts)
    || startedAt < CLOSEOUT_EPOCH_FLOOR_MS
    || endedAt < CLOSEOUT_EPOCH_FLOOR_MS
    || startedAt > ts + CLOSEOUT_FUTURE_SKEW_MS
    || endedAt > ts + CLOSEOUT_FUTURE_SKEW_MS
    || endedAt <= startedAt
  ) {
    return undefined;
  }

  return endedAt - startedAt;
}

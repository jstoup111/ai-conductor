export const rateLimitDurationUnitAlternation =
  'seconds|minutes|second|minute|hours|secs|mins|hour|sec|min|hrs|hr|s|m|h';

export function scaleRateLimitDurationSeconds(value: number, unit: string): number | undefined {
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  switch (unit.toLowerCase()[0]) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 3_600;
    default:
      return undefined;
  }
}

export function inferRateLimitWaitSeconds(value: number): number {
  return Math.min(Math.max(value * 60, 300), 3_600);
}

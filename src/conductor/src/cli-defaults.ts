import type { Command } from 'commander';

/** Default seconds between empty backlog polls in continuous daemon mode. */
export const DEFAULT_IDLE_POLL_SECONDS = 60;

/** Runtime fallbacks that must also be declared in Commander help. */
export const RUNTIME_FALLBACK_FLAGS = [
  { flag: '--idle-poll', value: DEFAULT_IDLE_POLL_SECONDS },
] as const;

export interface DefaultMismatch {
  flag: string;
  declared: string;
  runtime: number;
}

/**
 * Return runtime fallback flags whose Commander declaration advertises a
 * different default. Flags without a Commander default are intentionally not
 * part of this parity contract.
 */
export function defaultMismatches(
  table: readonly { flag: string; value: number }[],
  command: Pick<Command, 'options'>,
): DefaultMismatch[] {
  return table.flatMap(({ flag, value }) => {
    const declared = command.options.find((option) => option.long === flag)?.defaultValue;
    if (declared === undefined || String(declared) === String(value)) return [];
    return [{ flag, declared: String(declared), runtime: value }];
  });
}

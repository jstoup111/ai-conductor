import type { Command } from 'commander';
import { DEFAULT_IDLE_POLL_SECONDS } from '../../../src/cli-defaults.js';

/** Runtime fallbacks that must also be declared in Commander help. */
export const RUNTIME_FALLBACK_FLAGS = [
  { flag: '--idle-poll', value: DEFAULT_IDLE_POLL_SECONDS },
] as const;

export interface DefaultMismatch {
  flag: string;
  declared: string;
  runtime: number;
}

/** Return runtime fallback flags whose Commander declaration advertises a different default. */
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

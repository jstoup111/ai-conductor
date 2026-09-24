// daemon-exit-witness.ts — short-lived writer owned by the pane foreground
// wrapper. It deliberately writes a sibling ledger, never the event spine's
// `.daemon/events.jsonl`: a respawn can overlap two exiting wrappers.

import { appendFileSync, mkdirSync } from 'node:fs';
import { constants } from 'node:os';
import { dirname, join } from 'node:path';
import type { ConductorEvent } from '../types/events.js';

export interface ExitWitnessOptions {
  root: string;
  pid: number;
  status: number;
}

export interface ExitWitnessDependencies {
  append?: (path: string, line: string) => void;
  now?: () => Date;
}

export interface DaemonExitWitnessCommand {
  pid: number;
  status: number;
}

const USAGE = 'Usage: ai-conductor daemon exit-witness --pid <pid> --status <status>';

function signalForStatus(status: number): string | null {
  for (const [name, number] of Object.entries(constants.signals)) {
    if (status === 128 + number) return name;
  }
  return null;
}

/** Build the event shape registered in the ConductorEvent union. */
export function exitWitnessRecord(
  { pid, status }: Pick<ExitWitnessOptions, 'pid' | 'status'>,
  now: Date = new Date(),
): Extract<ConductorEvent, { type: 'daemon_exited' }> {
  const signal = signalForStatus(status);
  return {
    type: 'daemon_exited',
    pid,
    // Shell status 137 is solely the SIGKILL encoding, so it has no useful
    // process exit code. V8's SIGABRT status retains its conventional 134
    // code alongside the signal for the OOM diagnostic.
    code: signal === 'SIGKILL' ? null : status,
    signal,
    at: now.toISOString(),
  };
}

/**
 * Append one exit event. The record is serialized once and each append is one
 * small write, safely below PIPE_BUF. If its dedicated ledger is unavailable,
 * preserve the identical record in daemon.log and report failure to the pane.
 */
export function runExitWitness(
  options: ExitWitnessOptions,
  dependencies: ExitWitnessDependencies = {},
): number {
  const line = `${JSON.stringify(exitWitnessRecord(options, dependencies.now?.()))}\n`;
  const ledgerPath = join(options.root, '.daemon', 'exit-events.jsonl');
  const logPath = join(options.root, '.daemon', 'daemon.log');
  const append = dependencies.append ?? ((path: string, value: string) => appendFileSync(path, value, 'utf8'));

  try {
    mkdirSync(dirname(ledgerPath), { recursive: true });
    append(ledgerPath, line);
    return 0;
  } catch {
    try {
      mkdirSync(dirname(logPath), { recursive: true });
      append(logPath, line);
    } catch {
      // The wrapper must still terminate even if both diagnostics are lost.
    }
    return 1;
  }
}

/** Parse only this subverb; malformed witness invocations stay non-writing. */
export function detectDaemonExitWitnessCommand(argv: string[]): DaemonExitWitnessCommand | { invalidArgs: true } | null {
  if (argv[2] !== 'daemon' || argv[3] !== 'exit-witness') return null;
  const pidRaw = valueAfter(argv, '--pid');
  const statusRaw = valueAfter(argv, '--status');
  const pid = pidRaw === undefined ? Number.NaN : Number(pidRaw);
  const status = statusRaw === undefined ? Number.NaN : Number(statusRaw);
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(status) || status < 0) {
    return { invalidArgs: true };
  }
  return { pid, status };
}

export function dispatchDaemonExitWitness(
  command: DaemonExitWitnessCommand | { invalidArgs: true },
  root: string,
  out: (line: string) => void = console.error,
): number {
  if ('invalidArgs' in command) {
    out(USAGE);
    return 1;
  }
  return runExitWitness({ root, ...command });
}

function valueAfter(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  const value = index === -1 ? undefined : argv[index + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
}

// `conduct-ts intake-loop --continuous|--once` — production entry point for
// the background auto-intake loop (Task 17).
//
// Plan: .docs/plans/2026-06-30-background-intake-conduct-loop.md (Task 17)
// Stories: .docs/stories/background-intake-conduct-loop.md (FR-1..FR-12)
//
// This module is the PRODUCTION composition root for `runIntakeLoop`: it
// wires the real github-issues intake adapter (via `buildIntake` in
// engineer-cli.ts), a real status-surface notifier (`createNotifier`), a real
// push notification transport (sendNotification from ui/notifications.ts), a real
// `sleep`, a real clock, and `console.log`/`console.error`. It never spawns
// `claude` and never opens a PR — the loop stops at "routed + notified"
// (FR-11); DECIDE/authoring still happens in an interactive `/engineer`
// session started separately (Task 18 wraps this in a tmux pane).
//
// Zero-token guard (FR-9): this module and its transitive production imports
// (engineer-cli.ts's buildIntake, intake-loop.ts, notifier.ts,
// ui/notifications.ts) must never import an LLM/provider/claude-session module.
// ui/notifications.ts uses child_process and is inside the allowed set.
// See test/acceptance/background-intake-conduct-loop.test.ts for the static
// import-scan that enforces this.

import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { runIntakeLoop, type IntakeLoopDeps } from './engine/engineer/intake/intake-loop.js';
import { createNotifier } from './engine/engineer/intake/notifier.js';
import { buildIntake, makeProductionGh } from './engine/engineer-cli.js';
import { resolveEngineerDir } from './engine/engineer-store.js';
import { sendNotification } from './ui/notifications.js';

/** Default poll interval between intake ticks, in milliseconds. */
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

export type IntakeLoopDispatch =
  | { kind: 'run'; once: boolean; intervalMs: number }
  | { kind: 'guide' };

/**
 * Parse argv for the `intake-loop` subcommand.
 *   conduct-ts intake-loop --continuous [--interval-ms <n>] → {kind:'run', once:false, ...}
 *   conduct-ts intake-loop --once       [--interval-ms <n>] → {kind:'run', once:true, ...}
 *   conduct-ts intake-loop [anything else]                  → {kind:'guide'}
 *   (any other subcommand)                                  → null
 *
 * Malformed args return `guide` (never null) — a recognized-but-misused
 * subcommand must never fall through to the interactive pipeline launcher.
 */
export function detectIntakeLoopCommand(argv: string[]): IntakeLoopDispatch | null {
  if (argv[2] !== 'intake-loop') return null;
  const rest = argv.slice(3);
  const continuous = rest.includes('--continuous');
  const once = rest.includes('--once');
  if (continuous === once) {
    // Neither flag, or both flags given — ambiguous/malformed.
    return { kind: 'guide' };
  }
  let intervalMs = DEFAULT_INTERVAL_MS;
  const i = rest.indexOf('--interval-ms');
  if (i !== -1) {
    const v = rest[i + 1];
    const parsed = v ? Number(v) : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { kind: 'guide' };
    }
    intervalMs = parsed;
  }
  return { kind: 'run', once, intervalMs };
}

export interface DispatchIntakeLoopOpts {
  /** Injected for tests: overrides the real intake adapter composition root. */
  buildIntake?: typeof buildIntake;
  /** Injected for tests: overrides the real notifier factory. */
  createNotifier?: typeof createNotifier;
  /** Injected for tests: overrides the real push notification transport. */
  sendNotification?: typeof sendNotification;
  /** Injected for tests: overrides the real interval scheduler. */
  runIntakeLoop?: typeof runIntakeLoop;
  /** Injected for tests: overrides the real sleep effect. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for tests: overrides the real clock. */
  now?: () => Date;
  /** Injected for tests: overrides `console.log`. */
  log?: (msg: string) => void;
  /** Injected for tests: overrides `console.error`. */
  printErr?: (msg: string) => void;
  engineerDir?: string;
  registryPath?: string;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Dispatch the `intake-loop` subcommand.
 *
 * Wires real production deps — the github-issues intake adapter, a real
 * status-surface notifier, real sleep/clock, and console logging — into the
 * pure-core `runIntakeLoop`. This is the exact composition the daemon's
 * background poll pane runs; it never spawns `claude` and never opens a PR.
 */
export async function dispatchIntakeLoop(
  cmd: IntakeLoopDispatch,
  opts: DispatchIntakeLoopOpts = {},
): Promise<number> {
  if (cmd.kind === 'guide') {
    console.error(
      'conduct-ts intake-loop --continuous|--once [--interval-ms <n>]\n' +
        '  Runs the background intake poll loop: polls registered repos for newly\n' +
        '  captured ideas, enqueues them into the durable inbox, and notifies the\n' +
        '  operator via the status surface. Never spawns claude, never opens a PR —\n' +
        '  DECIDE/authoring still happens in an interactive `conduct-ts engineer`\n' +
        '  session started separately.\n' +
        '  --continuous       loop forever (poll, sleep, repeat)\n' +
        '  --once             run exactly one poll tick and exit\n' +
        '  --interval-ms <n>  delay between ticks in ms (default 300000 = 5m)\n',
    );
    return 1;
  }

  const log = opts.log ?? ((msg: string) => console.log(msg));
  const printErr = opts.printErr ?? ((msg: string) => console.error(msg));
  const build = opts.buildIntake ?? buildIntake;
  const makeNotifier = opts.createNotifier ?? createNotifier;
  const notify = opts.sendNotification ?? sendNotification;
  const loop = opts.runIntakeLoop ?? runIntakeLoop;
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? (() => new Date());
  const engineerDir = opts.engineerDir ?? resolveEngineerDir({});

  const { queue, adapter } = build({
    engineerDir,
    registryPath: opts.registryPath,
    gh: makeProductionGh(),
    printErr,
  });

  const statusPath = join(engineerDir, 'intake-status.json');
  const notifier = makeNotifier({
    writeStatus: async (status) => {
      await mkdir(engineerDir, { recursive: true });
      await writeFile(statusPath, JSON.stringify(status, null, 2) + '\n', 'utf-8');
    },
    push: async (ideas) => {
      if (!Array.isArray(ideas) || ideas.length === 0) {
        return;
      }
      const sourceRefs = ideas.map((i) => i.sourceRef).join(', ');
      const message = `${ideas.length} new idea(s): ${sourceRefs}`;
      await notify('Intake: new ideas queued', message);
    },
    now: () => now().toISOString(),
    log,
  });

  const deps: IntakeLoopDeps = {
    poll: () => adapter.poll(),
    enqueue: (envelope) => queue.enqueue(envelope),
    notify: (ideas) => notifier.notify(ideas),
    sleep,
    now,
    log,
  };

  await loop(deps, { intervalMs: cmd.intervalMs, once: cmd.once });
  return 0;
}

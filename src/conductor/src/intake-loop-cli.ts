// `ai-conductor intake-loop --continuous|--once` — production entry point for
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
import { reconcileClosedIssues, type GetIssueState } from './engine/engineer/intake/reconcile-closed-issues.js';
import {
  sweepDependencyDrift,
  type DependencyDriftBlocker,
  type DependencyDriftIssue,
  type DependencyDriftResult,
  type DependencyDriftTracker,
} from './engine/engineer/dependency-reconciler.js';
import { buildIntake, makeProductionGh } from './engine/engineer-cli.js';
import type { IntakeEventEmitter } from './engine/intake-backend-composite.js';
import { runTrackerRepositoryRead } from './engine/tracker-client.js';
import { resolveTrackerSelection } from './engine/tracker-selection.js';
import { resolveEngineerDir } from './engine/engineer-store.js';
import { sendNotification } from './ui/notifications.js';
import type { EventHandler } from './ui/events.js';

/** Default poll interval between intake ticks, in milliseconds. */
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
/** The approved drift-audit cadence: at most one read-only sweep per repository per hour. */
export const DRIFT_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export type IntakeLoopDispatch =
  | { kind: 'run'; once: boolean; intervalMs: number }
  | { kind: 'guide' };

/**
 * Parse argv for the `intake-loop` subcommand.
 *   ai-conductor intake-loop --continuous [--interval-ms <n>] → {kind:'run', once:false, ...}
 *   ai-conductor intake-loop --once       [--interval-ms <n>] → {kind:'run', once:true, ...}
 *   ai-conductor intake-loop [anything else]                  → {kind:'guide'}
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
  /** Injected for tests: overrides the real `gh` CLI runner used for polling and issue-state probes. */
  gh?: ReturnType<typeof makeProductionGh>;
  /** Existing operator event spine for tracker-backend exclusion telemetry. */
  events?: IntakeEventEmitter;
  /** Injectable sweep seam; production uses the shared dependency reconciler. */
  sweepDependencyDrift?: typeof sweepDependencyDrift;
  /** Injectable read-only tracker seam; production uses the guarded repository-read runner. */
  createDependencyDriftTracker?: () => DependencyDriftTracker;
  /** Injectable so the composed reconcile boundary can be observed without filesystem fixtures. */
  reconcileClosedIssues?: typeof reconcileClosedIssues;
  engineerDir?: string;
  registryPath?: string;
}

function parseJson(value: string): unknown {
  return JSON.parse(value || '[]') as unknown;
}

function asDriftIssues(value: unknown): DependencyDriftIssue[] {
  if (!Array.isArray(value)) throw new Error('open issue listing was not an array');
  return value.map((issue) => {
    if (!issue || typeof issue !== 'object') throw new Error('open issue listing contained an invalid issue');
    const item = issue as { number?: unknown; body?: unknown };
    if (typeof item.number !== 'number' || !Number.isSafeInteger(item.number) || (typeof item.body !== 'string' && item.body !== null && item.body !== undefined)) {
      throw new Error('open issue listing contained an invalid issue');
    }
    return { number: item.number, body: item.body ?? '' };
  });
}

function asDriftBlockers(value: unknown): DependencyDriftBlocker[] {
  if (!Array.isArray(value)) throw new Error('blocked_by response was not an array');
  return value.map((blocker) => {
    if (!blocker || typeof blocker !== 'object') throw new Error('blocked_by response contained an invalid blocker');
    const item = blocker as { number?: unknown; state?: unknown; state_reason?: unknown; repository?: unknown; repository_url?: unknown };
    if (typeof item.number !== 'number' || !Number.isSafeInteger(item.number) || (item.state !== 'open' && item.state !== 'closed')) {
      throw new Error('blocked_by response contained an invalid blocker');
    }
    return {
      number: item.number,
      state: item.state,
      ...(typeof item.state_reason === 'string' ? { state_reason: item.state_reason } : {}),
      ...(typeof item.repository === 'string' ? { repository: item.repository } : {}),
      ...(typeof item.repository_url === 'string' ? { repository_url: item.repository_url } : {}),
    };
  });
}

function productionDependencyDriftTracker(gh: ReturnType<typeof makeProductionGh>, cwd: string): DependencyDriftTracker {
  return {
    async listOpenIssues(repository) {
      const stdout = await runTrackerRepositoryRead(
        gh, cwd, 'repository.read', repository, { kind: 'repository' },
        ['issue', 'list', '--state', 'open', '--json', 'number,body', '--limit', '1000', '-R', repository],
      );
      return asDriftIssues(parseJson(stdout));
    },
    async getBlockedBy(repository, number) {
      const stdout = await runTrackerRepositoryRead(
        gh, cwd, 'issue.read', repository, { kind: 'issue', number },
        ['api', `repos/${repository}/issues/${number}/dependencies/blocked_by`],
      );
      return asDriftBlockers(parseJson(stdout));
    },
  };
}

function driftEvent(repository: string, result: DependencyDriftResult): Extract<import('./types/events.js').ConductorEvent, { type: 'dependency_drift_swept' }> {
  const edge = (finding: { source: string; target: string }) => `${finding.source} -> ${finding.target}`;
  return {
    type: 'dependency_drift_swept',
    repository,
    status: result.kind,
    unlinked: result.unlinked.map(edge),
    stale: result.stale.map(edge),
    cycles: result.cycles.map((cycle) => cycle.members.join(' -> ')),
    contradictions: result.contradictions.map(edge),
    indeterminate: [...result.indeterminate],
  };
}

function repositoryForDrift(project: { name: string; remote?: string }): string {
  const match = project.remote?.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  return match?.[1] ?? project.name;
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
      'ai-conductor intake-loop --continuous|--once [--interval-ms <n>]\n' +
        '  Runs the background intake poll loop: polls registered repos for newly\n' +
        '  captured ideas, enqueues them into the durable inbox, and notifies the\n' +
        '  operator via the status surface. Never spawns claude, never opens a PR —\n' +
        '  DECIDE/authoring still happens in an interactive `ai-conductor compose`\n' +
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
  const gh = opts.gh ?? makeProductionGh();
  const driftSweep = opts.sweepDependencyDrift ?? sweepDependencyDrift;
  const driftTracker = opts.createDependencyDriftTracker ?? (() => productionDependencyDriftTracker(gh, engineerDir));
  const reconcileClosed = opts.reconcileClosedIssues ?? reconcileClosedIssues;

  const { reader, ledger, queue, adapter } = build({
    engineerDir,
    registryPath: opts.registryPath,
    gh,
    printErr,
    events: opts.events,
  });

  const renderBackendUnavailable: EventHandler = (event) => {
    if (event.type === 'tracker_backend_unavailable') {
      printErr(`tracker backend unavailable: ${event.project} selected ${event.backend} (${event.reason})`);
    }
  };
  opts.events?.on?.('tracker_backend_unavailable', renderBackendUnavailable);

  // Brain sweep (Task 16): reconcile the intake ledger against closed GitHub
  // issues so a closed issue can't be claimed again. Reuses the same `gh`
  // runner already wired for the poll adapter — `gh issue view <n> --repo
  // <repo> --json state -q .state`, modeled on halt-issues' getIssueState.
  const getIssueState: GetIssueState = async (repo, issue) => {
    try {
      const stdout = await runTrackerRepositoryRead(
        gh, engineerDir, 'issue.read', repo, { kind: 'issue', number: Number(issue) },
        ['issue', 'view', issue, '--repo', repo, '--json', 'state', '-q', '.state'],
      );
      const state = stdout.trim().toLowerCase();
      return state === 'open' || state === 'closed' ? state : null;
    } catch {
      return null;
    }
  };
  const lastDriftSweepAt = new Map<string, number>();
  const reconcile = async () => {
    const summary = await reconcileClosed({ ledger, queue, getIssueState }, { dryRun: false });
    const tickAt = now().getTime();
    const projects = await reader.listProjects();
    for (const project of projects) {
      const selection = await resolveTrackerSelection(project.path);
      if (!selection.ok || selection.selection.backend !== 'github') continue;
      const repository = repositoryForDrift(project);
      const lastRun = lastDriftSweepAt.get(repository);
      if (lastRun !== undefined && tickAt - lastRun < DRIFT_SWEEP_INTERVAL_MS) continue;
      // Stamp before the read: a failed sweep must not hot-loop on every intake tick.
      lastDriftSweepAt.set(repository, tickAt);
      try {
        const result = await driftSweep({ repository, tracker: driftTracker() });
        await opts.events?.emit(driftEvent(repository, result));
      } catch (error) {
        log(`intake loop: dependency drift sweep failed for ${repository}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return summary;
  };

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
    probeLedger: async () => {
      await ledger.list();
    },
    poll: () => adapter.poll(),
    enqueue: (envelope) => queue.enqueue(envelope),
    notify: (ideas) => notifier.notify(ideas),
    sleep,
    now,
    log,
    reconcile,
  };

  try {
    await loop(deps, { intervalMs: cmd.intervalMs, once: cmd.once });
    return 0;
  } finally {
    opts.events?.off?.('tracker_backend_unavailable', renderBackendUnavailable);
  }
}

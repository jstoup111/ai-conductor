import { existsSync, readFileSync } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { StepName } from '../../types/steps.js';
import type { TranscriptOwnerStep } from '../../types/events.js';
import { isBuiltInProviderId } from '../../execution/provider-catalog.js';
import type { SelfHostProviderId } from './provider-home.js';
import { isStepName } from '../execution-identity.js';
import { ConductorEventEmitter, type EventHandler } from '../../ui/events.js';

/** Every terminal step disposition that decides an attempt's captured transcripts. */
export type TranscriptRetentionOutcome =
  | 'succeeded-with-progress'
  | 'succeeded-without-progress'
  | 'failed'
  | 'stalled'
  | 'halted'
  | 'needs-human';

/**
 * Identity of a provider-capture dispatch. This is intentionally distinct
 * from the retry/escalation counter: a non-consuming retry can reuse the
 * latter but must never settle the former's transcript directory.
 */
declare const transcriptCaptureDispatchIdentity: unique symbol;
export type TranscriptCaptureDispatchIdentity = number & {
  readonly [transcriptCaptureDispatchIdentity]: 'TranscriptCaptureDispatchIdentity';
};

export function asTranscriptCaptureDispatchIdentity(
  dispatch: number,
): TranscriptCaptureDispatchIdentity {
  return dispatch as TranscriptCaptureDispatchIdentity;
}

export const TRANSCRIPT_RETENTION_MAX_CAPTURES = 20;
export const TRANSCRIPT_RETENTION_MAX_BYTES = 1_073_741_824;

export interface TranscriptRetentionDependencies {
  readonly remove?: (path: string) => Promise<void>;
  readonly maxCaptures?: number;
  readonly maxBytes?: number;
  /** Sweeps retain only captures they recover; they must not settle live work. */
  readonly reconcile?: boolean;
}

/**
 * The owner portion of a capture identity is closed deliberately.  A rubric
 * name is an auxiliary member, never a lifecycle step, so callers cannot
 * accidentally key a rubric capture as though it were a StepName.
 */
export type TranscriptCaptureMember =
  | { readonly kind: 'absent' }
  | { readonly kind: 'present'; readonly value: string };

export interface TranscriptCaptureIdentity {
  readonly step: StepName;
  readonly member: TranscriptCaptureMember;
  readonly runId: string;
  readonly attempt: number;
}

/** Build the sole step/member identity used for capture recording and settlement. */
export function transcriptCaptureIdentity(input: {
  readonly step: StepName;
  readonly runId: string;
  readonly attempt: number;
  readonly member?: string;
}): TranscriptCaptureIdentity {
  return {
    step: input.step,
    member: input.member === undefined ? { kind: 'absent' } : { kind: 'present', value: input.member },
    runId: input.runId,
    attempt: input.attempt,
  };
}

type CapturedTranscript = TranscriptCaptureIdentity & {
  readonly path: string;
  readonly interrupted: boolean;
};

type TranscriptEventRecord = {
  readonly type?: unknown;
  readonly step?: unknown;
  readonly path?: unknown;
  readonly interrupted?: unknown;
  readonly runId?: unknown;
  readonly attempt?: unknown;
  readonly member?: unknown;
  readonly provider?: unknown;
  readonly ts?: unknown;
};

export type TranscriptLedgerState = 'pending' | 'retained' | 'pruned' | 'evicted';
export interface TranscriptLedgerCapture {
  readonly step: TranscriptOwnerStep;
  readonly runId: string;
  readonly attempt: number;
  readonly member?: string;
  readonly provider: SelfHostProviderId | 'unknown';
  readonly path: string;
  readonly interrupted: boolean;
  /** Parsed persisted ISO timestamp, absent only for malformed legacy rows. */
  readonly capturedAt?: number;
  readonly order: number;
  readonly state: TranscriptLedgerState;
}

/** Fold the canonical event ledger into each capture's identity, time, and lifecycle state. */
export function foldTranscriptLedger(content: string): Map<string, TranscriptLedgerCapture> {
  const captures = new Map<string, TranscriptLedgerCapture>();
  let order = 0;
  for (const line of content.split('\n')) {
    if (!line) continue;
    let event: TranscriptEventRecord;
    try { event = JSON.parse(line) as TranscriptEventRecord; } catch { continue; }
    if (typeof event.path !== 'string') continue;
    if (event.type === 'provider_transcripts_captured' && isTranscriptOwnerStep(event.step)) {
      const capturedAt = typeof event.ts === 'string' ? Date.parse(event.ts) : Number.NaN;
      captures.set(event.path, {
        step: event.step, runId: typeof event.runId === 'string' ? event.runId : 'unknown',
        attempt: typeof event.attempt === 'number' ? event.attempt : 0,
        ...(typeof event.member === 'string' ? { member: event.member } : {}),
        provider: typeof event.provider === 'string' && isBuiltInProviderId(event.provider)
          ? event.provider
          : 'unknown',
        path: event.path, interrupted: event.interrupted === true,
        ...(Number.isNaN(capturedAt) ? {} : { capturedAt }), order: order++, state: 'pending',
      });
      continue;
    }
    const capture = captures.get(event.path);
    if (!capture) continue;
    const state = event.type === 'provider_transcripts_retained' ? 'retained'
      : event.type === 'provider_transcripts_pruned' ? 'pruned'
        : event.type === 'provider_transcripts_evicted' ? 'evicted' : undefined;
    if (state) captures.set(event.path, { ...capture, state });
  }
  return captures;
}

type RetainedCapture = {
  readonly path: string;
  readonly size: number;
  readonly capturedAt: number;
  readonly order: number;
};

/**
 * Retains captured provider transcripts until the conductor knows whether the
 * owning step made progress. The canonical event ledger is the recovery index;
 * no retention state is written beside the captures.
 */
export class TranscriptRetention {
  private readonly pending = new Map<string, CapturedTranscript[]>();
  private readonly remove: (path: string) => Promise<void>;
  private readonly maxCaptures: number;
  private readonly maxBytes: number;
  private readonly capturedHandler: EventHandler;
  private readonly reconciliation: Promise<void>;

  constructor(
    private readonly worktreePath: string,
    private readonly events: ConductorEventEmitter,
    dependencies: TranscriptRetentionDependencies = {},
  ) {
    this.remove = dependencies.remove ?? ((path) => rm(path, { recursive: true, force: true }));
    this.maxCaptures = dependencies.maxCaptures ?? TRANSCRIPT_RETENTION_MAX_CAPTURES;
    this.maxBytes = dependencies.maxBytes ?? TRANSCRIPT_RETENTION_MAX_BYTES;
    this.capturedHandler = (event) => {
      if (event.type !== 'provider_transcripts_captured') return;
      // Legacy unknown-step captures have no lifecycle terminal that can
      // settle them. Retain them immediately rather than inventing an
      // incomplete identity outside the StepName domain.
      if (!isStepName(event.step)) return this.retain(event.path);
      const step = event.step;
      return this.capture({
        ...transcriptCaptureIdentity({
          step,
          runId: event.runId,
          attempt: event.attempt,
          ...(event.member === undefined ? {} : { member: event.member }),
        }),
        path: event.path,
        interrupted: event.interrupted,
      });
    };
    this.events.on('provider_transcripts_captured', this.capturedHandler);
    this.reconciliation = dependencies.reconcile === false ? Promise.resolve() : this.reconcile();
  }

  /** Await startup reconciliation when a caller needs recovered captures recorded first. */
  ready(): Promise<void> {
    return this.reconciliation;
  }

  stop(): void {
    this.events.off('provider_transcripts_captured', this.capturedHandler);
  }

  async settle(step: StepName, outcome: TranscriptRetentionOutcome): Promise<void> {
    const keys = [...this.pending.keys()].filter((key) => key.startsWith(`${step}\u0000`));
    await this.settleKeys(keys, outcome);
  }

  /** Settle exactly one provider capture dispatch without affecting a later retry. */
  async settleAttempt(
    identity: Omit<TranscriptCaptureIdentity, 'attempt' | 'member'> & {
      readonly attempt: TranscriptCaptureDispatchIdentity;
      readonly member?: string;
    },
    outcome: TranscriptRetentionOutcome,
  ): Promise<void> {
    await this.settleKeys([captureKey(transcriptCaptureIdentity(identity))], outcome);
  }

  /** Settle all captured members of one terminal lifecycle step by their own identities. */
  async settleStepRun(step: StepName, runId: string, outcome: TranscriptRetentionOutcome): Promise<void> {
    const identities = [...this.pending.values()].flatMap((captures) => captures)
      .filter((capture) => capture.step === step && capture.runId === runId)
      .map(({ step: captureStep, runId: captureRunId, attempt, member }) => ({
        step: captureStep,
        runId: captureRunId,
        attempt: asTranscriptCaptureDispatchIdentity(attempt),
        ...(member.kind === 'present' ? { member: member.value } : {}),
      }));
    for (const identity of identities) await this.settleAttempt(identity, outcome);
  }

  /**
   * A retry is emitted after its failed provider dispatch has torn down and
   * before the replacement dispatch starts. Therefore every pending capture
   * in the matching scope belongs to an earlier dispatch sequence. Capture
   * sequence is deliberately independent from the retry-budget attempt: that
   * counter can reset for a non-consuming retry.
   *
   * A configured dispatch can own an unlabelled capture or auxiliary rubric
   * captures under the same step; filtering to its exact member would leave
   * those failed captures pending for a later success to prune.
   */
  async settleBeforeRetry(scope: {
    readonly step: StepName;
    readonly runId?: string;
  }): Promise<void> {
    const identities = [...this.pending.entries()].flatMap(([key, captures]) => {
      const capture = captures[0];
      return capture !== undefined
        && capture.step === scope.step
        && (scope.runId === undefined || capture.runId === scope.runId)
        ? [{ key, capture }]
        : [];
    });
    for (const { capture } of identities) {
      await this.settleAttempt({
        step: capture.step,
        runId: capture.runId,
        attempt: asTranscriptCaptureDispatchIdentity(capture.attempt),
        ...(capture.member.kind === 'present' ? { member: capture.member.value } : {}),
      }, 'failed');
    }
  }

  private async settleKeys(keys: readonly string[], outcome: TranscriptRetentionOutcome): Promise<void> {
    const paths = keys.flatMap((key) => {
      const captured = this.pending.get(key) ?? [];
      this.pending.delete(key);
      return captured.map(({ path }) => path);
    });
    switch (outcome) {
      case 'succeeded-with-progress':
        await Promise.all(paths.map((path) => this.prune(path)));
        return;
      case 'succeeded-without-progress':
      case 'failed':
      case 'stalled':
      case 'halted':
      case 'needs-human':
        for (const path of paths) await this.retain(path);
        return;
    }
    return assertNever(outcome);
  }

  private async capture(capture: CapturedTranscript): Promise<void> {
    if (capture.interrupted) {
      await this.retain(capture.path);
      return;
    }
    const key = captureKey(capture);
    const captures = this.pending.get(key) ?? [];
    captures.push(capture);
    this.pending.set(key, captures);
  }

  private async reconcile(): Promise<void> {
    const eventsPath = join(this.worktreePath, '.pipeline', 'events.jsonl');
    let content: string;
    try {
      content = readFileSync(eventsPath, 'utf8');
    } catch {
      return;
    }

    for (const capture of foldTranscriptLedger(content).values()) {
      if (capture.state === 'pending' && existsSync(join(this.worktreePath, capture.path))) {
        await this.retain(capture.path);
      }
    }
  }

  private async retain(path: string): Promise<void> {
    await this.events.emit({ type: 'provider_transcripts_retained', path });
    await this.enforceCap();
  }

  private async enforceCap(): Promise<void> {
    const captures = await this.listRetainedCaptures();
    let totalBytes = captures.reduce((total, capture) => total + capture.size, 0);
    while (captures.length > 1 && (captures.length > this.maxCaptures || totalBytes > this.maxBytes)) {
      const capture = captures[0]!;
      const reason = captures.length > this.maxCaptures ? 'count' : 'size';
      try {
        await this.remove(join(this.worktreePath, capture.path));
        await this.events.emit({ type: 'provider_transcripts_evicted', path: capture.path, reason });
      } catch (error) {
        await this.events.emit({
          type: 'provider_transcripts_retention_failed',
          path: capture.path,
          action: 'evict',
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      captures.shift();
      totalBytes -= capture.size;
    }
  }

  private async listRetainedCaptures(): Promise<RetainedCapture[]> {
    const ledger = this.readTranscriptLedger();
    const transcriptsPath = join(this.worktreePath, '.pipeline', 'transcripts');
    let steps;
    try {
      steps = await readdir(transcriptsPath, { withFileTypes: true });
    } catch {
      return [];
    }

    const captures: RetainedCapture[] = [];
    for (const step of steps) {
      if (!step.isDirectory()) continue;
      let directories;
      try {
        directories = await readdir(join(transcriptsPath, step.name), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const directory of directories) {
        if (!directory.isDirectory()) continue;
        const path = join('.pipeline', 'transcripts', step.name, directory.name);
        const absolutePath = join(this.worktreePath, path);
        const metadata = await stat(absolutePath).catch(() => undefined);
        if (metadata === undefined) continue;
        const capture = ledger.get(path);
        // The cap applies only to captures already retained by a terminal
        // verdict. Pending attempts remain recoverable until their own verdict.
        if (capture?.state !== 'retained') continue;
        captures.push({
          path,
          size: await directorySize(absolutePath),
          capturedAt: capture.capturedAt ?? metadata.mtimeMs,
          order: capture.order,
        });
      }
    }
    return captures.sort((left, right) => (
      left.capturedAt - right.capturedAt || left.order - right.order || left.path.localeCompare(right.path)
    ));
  }

  private readTranscriptLedger(): Map<string, TranscriptLedgerCapture> {
    const eventsPath = join(this.worktreePath, '.pipeline', 'events.jsonl');
    let content: string;
    try {
      content = readFileSync(eventsPath, 'utf8');
    } catch {
      return new Map();
    }
    return foldTranscriptLedger(content);
  }

  private async prune(path: string): Promise<void> {
    try {
      await this.remove(join(this.worktreePath, path));
      await this.events.emit({ type: 'provider_transcripts_pruned', path });
    } catch (error) {
      await this.events.emit({
        type: 'provider_transcripts_retention_failed',
        path,
        action: 'prune',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function directorySize(path: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(entryPath);
    } else if (entry.isFile()) {
      total += (await stat(entryPath)).size;
    }
  }
  return total;
}

function isTranscriptOwnerStep(value: unknown): value is TranscriptOwnerStep {
  return value === 'unknown-step' || isStepName(value);
}

function captureKey(identity: TranscriptCaptureIdentity): string {
  return [
    identity.step,
    identity.runId,
    identity.attempt,
    identity.member.kind === 'present' ? identity.member.value : '',
  ].join('\u0000');
}

function assertNever(value: never): never {
  throw new Error(`Unhandled transcript retention outcome: ${value}`);
}

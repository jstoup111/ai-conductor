import { existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { StepName } from '../../types/steps.js';
import { ConductorEventEmitter, type EventHandler } from '../../ui/events.js';

/** Every terminal step disposition that decides an attempt's captured transcripts. */
export type TranscriptRetentionOutcome =
  | 'succeeded-with-progress'
  | 'succeeded-without-progress'
  | 'failed'
  | 'stalled'
  | 'halted'
  | 'needs-human';

export interface TranscriptRetentionDependencies {
  readonly remove?: (path: string) => Promise<void>;
}

type CapturedTranscript = {
  readonly step: StepName;
  readonly path: string;
  readonly interrupted: boolean;
};

type TranscriptEventRecord = {
  readonly type?: unknown;
  readonly step?: unknown;
  readonly path?: unknown;
  readonly interrupted?: unknown;
};

/**
 * Retains captured provider transcripts until the conductor knows whether the
 * owning step made progress. The canonical event ledger is the recovery index;
 * no retention state is written beside the captures.
 */
export class TranscriptRetention {
  private readonly pending = new Map<StepName, string[]>();
  private readonly remove: (path: string) => Promise<void>;
  private readonly capturedHandler: EventHandler;
  private readonly reconciliation: Promise<void>;

  constructor(
    private readonly worktreePath: string,
    private readonly events: ConductorEventEmitter,
    dependencies: TranscriptRetentionDependencies = {},
  ) {
    this.remove = dependencies.remove ?? ((path) => rm(path, { recursive: true, force: true }));
    this.capturedHandler = (event) => {
      if (event.type !== 'provider_transcripts_captured') return;
      return this.capture({ step: event.step, path: event.path, interrupted: event.interrupted });
    };
    this.events.on('provider_transcripts_captured', this.capturedHandler);
    this.reconciliation = this.reconcile();
  }

  /** Await startup reconciliation when a caller needs recovered captures recorded first. */
  ready(): Promise<void> {
    return this.reconciliation;
  }

  stop(): void {
    this.events.off('provider_transcripts_captured', this.capturedHandler);
  }

  async settle(step: StepName, outcome: TranscriptRetentionOutcome): Promise<void> {
    const paths = this.pending.get(step) ?? [];
    this.pending.delete(step);
    switch (outcome) {
      case 'succeeded-with-progress':
        await Promise.all(paths.map((path) => this.prune(path)));
        return;
      case 'succeeded-without-progress':
      case 'failed':
      case 'stalled':
      case 'halted':
      case 'needs-human':
        await Promise.all(paths.map((path) => this.retain(path)));
        return;
    }
    return assertNever(outcome);
  }

  private async capture(capture: CapturedTranscript): Promise<void> {
    if (capture.interrupted) {
      await this.retain(capture.path);
      return;
    }
    const paths = this.pending.get(capture.step) ?? [];
    paths.push(capture.path);
    this.pending.set(capture.step, paths);
  }

  private async reconcile(): Promise<void> {
    const eventsPath = join(this.worktreePath, '.pipeline', 'events.jsonl');
    let content: string;
    try {
      content = readFileSync(eventsPath, 'utf8');
    } catch {
      return;
    }

    const captures = new Map<string, CapturedTranscript>();
    const settled = new Set<string>();
    for (const line of content.split('\n')) {
      if (!line) continue;
      let event: TranscriptEventRecord;
      try {
        event = JSON.parse(line) as TranscriptEventRecord;
      } catch {
        continue;
      }
      if (typeof event.path !== 'string') continue;
      if (event.type === 'provider_transcripts_captured' && isStepName(event.step)) {
        captures.set(event.path, { step: event.step, path: event.path, interrupted: event.interrupted === true });
      } else if (
        event.type === 'provider_transcripts_retained'
        || event.type === 'provider_transcripts_pruned'
        || event.type === 'provider_transcripts_evicted'
      ) {
        settled.add(event.path);
      }
    }

    await Promise.all([...captures.values()]
      .filter((capture) => !settled.has(capture.path) && existsSync(join(this.worktreePath, capture.path)))
      .map((capture) => this.retain(capture.path)));
  }

  private async retain(path: string): Promise<void> {
    await this.events.emit({ type: 'provider_transcripts_retained', path });
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

function isStepName(value: unknown): value is StepName {
  return typeof value === 'string';
}

function assertNever(value: never): never {
  throw new Error(`Unhandled transcript retention outcome: ${value}`);
}

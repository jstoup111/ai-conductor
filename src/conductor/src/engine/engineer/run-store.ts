import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type {
  ComplexityTier,
  EngineerLifecycleEvent,
  EngineerStepCompletionEvidence,
  EngineerStepName,
} from '../../types/index.js';
import { ConductorEventEmitter } from '../../ui/events.js';
import { EventPersister } from '../event-persister.js';

export const ENGINEER_LIFECYCLE_CAPABILITY = 'engineerLifecycleEventsV1' as const;
export const ENGINEER_LIFECYCLE_SCHEMA_VERSION = 1 as const;

const TERMINAL_STATES = new Set<EngineerRunState>(['cancelled', 'failed', 'settled']);
const STEP_NAMES = new Set<EngineerStepName>([
  'bootstrap',
  'memory',
  'assess',
  'explore',
  'complexity',
  'prd',
  'architecture_diagram',
  'architecture_review',
  'stories',
  'conflict_check',
  'plan',
  'coherence_check',
]);

export type EngineerRunState =
  | 'created'
  | 'authoring'
  | 'awaiting_spec_merge'
  | 'cancelled'
  | 'failed'
  | 'settled';

export interface EngineerStepSnapshot {
  status: 'started' | 'completed' | 'failed' | 'retrying' | 'skipped';
  attempt: number;
  completion?: EngineerStepCompletionEvidence;
  provider?: string;
  model?: string;
  error?: string;
  reason?: string;
  artifactPaths?: string[];
}

export interface EngineerHandoffIdentity {
  planSlug: string;
  branch: string;
  prUrl: string | null;
  outcome: 'pr_opened' | 'local_commit';
}

export interface EngineerRunSnapshot {
  schemaVersion: 1;
  capability: typeof ENGINEER_LIFECYCLE_CAPABILITY;
  engineerRunId: string;
  correlationId: string | null;
  attemptKey: string;
  attempt: number;
  previousEngineerRunId: string | null;
  repoRoot: string;
  idea: string;
  eventRevision: number;
  state: EngineerRunState;
  project: string | null;
  worktree: { path: string; branch: string; planSlug: string } | null;
  steps: Partial<Record<EngineerStepName, EngineerStepSnapshot>>;
  reconciliation: {
    planSlug: string;
    track: 'product' | 'technical';
    tier: ComplexityTier;
    completed: EngineerStepName[];
    skipped: EngineerStepName[];
  } | null;
  handoff: EngineerHandoffIdentity | null;
  terminalReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RunMetadata {
  schemaVersion: 1;
  engineerRunId: string;
  correlationId: string | null;
  attemptKey: string;
  attempt: number;
  previousEngineerRunId: string | null;
  repoRoot: string;
  idea: string;
  createdAt: string;
}

interface AttemptIndex {
  schemaVersion: 1;
  attemptKey: string;
  engineerRunId: string;
}

interface CorrelationIndex {
  schemaVersion: 1;
  correlationId: string;
  repoRoot: string;
  idea: string;
  engineerRunIds: string[];
}

export type EngineerTransition =
  | { kind: 'run_started' }
  | { kind: 'routing_selected'; project: string }
  | { kind: 'worktree_created'; worktreePath: string; branch: string; planSlug: string }
  | { kind: 'step_started'; step: EngineerStepName; provider?: string; model?: string }
  | {
      kind: 'step_completed';
      step: EngineerStepName;
      completion: EngineerStepCompletionEvidence;
      artifactPaths?: string[];
    }
  | { kind: 'step_failed'; step: EngineerStepName; error: string }
  | { kind: 'step_retried'; step: EngineerStepName; reason: string }
  | { kind: 'step_skipped'; step: EngineerStepName; reason: string }
  | {
      kind: 'land_reconciled';
      planSlug: string;
      track: 'product' | 'technical';
      tier: ComplexityTier;
      completed: EngineerStepName[];
      skipped: EngineerStepName[];
    }
  | { kind: 'land_refused'; reason: string }
  | { kind: 'spec_handoff'; planSlug: string; branch: string; prUrl: string | null; outcome: 'pr_opened' | 'local_commit' }
  | { kind: 'run_cancelled'; reason: string }
  | { kind: 'run_failed'; error: string }
  | { kind: 'run_settled'; outcome: 'awaiting_spec_merge' };

export class EngineerLifecycleError extends Error {
  constructor(
    public readonly code:
      | 'attempt_key_collision'
      | 'correlation_repository_collision'
      | 'correlation_idea_collision'
      | 'live_attempt_exists'
      | 'run_not_found'
      | 'terminal_run'
      | 'invalid_transition'
      | 'invalid_step'
      | 'invalid_completion_evidence'
      | 'invalid_run_id'
      | 'revision_regression'
      | 'revision_ahead'
      | 'journal_corrupt'
      | 'schema_mismatch'
      | 'identity_mismatch'
      | 'lock_timeout',
    message: string,
  ) {
    super(message);
    this.name = 'EngineerLifecycleError';
  }
}

export interface EngineerRunStoreOptions {
  engineerDir: string;
  events: ConductorEventEmitter;
  now?: () => Date;
  id?: () => string;
}

export class EngineerRunStore {
  private readonly root: string;
  private readonly runsRoot: string;
  private readonly attemptsRoot: string;
  private readonly correlationsRoot: string;
  private readonly locksRoot: string;
  private readonly events: ConductorEventEmitter;
  private readonly now: () => Date;
  private readonly id: () => string;

  constructor(options: EngineerRunStoreOptions) {
    this.root = join(options.engineerDir, 'lifecycle');
    this.runsRoot = join(this.root, 'runs');
    this.attemptsRoot = join(this.root, 'indexes', 'attempts');
    this.correlationsRoot = join(this.root, 'indexes', 'correlations');
    this.locksRoot = join(this.root, 'locks');
    this.events = options.events;
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? randomUUID;
  }

  async create(input: {
    repoRoot: string;
    idea: string;
    correlationId?: string | null;
    attemptKey?: string;
  }): Promise<EngineerRunSnapshot> {
    const repoRoot = await realpath(input.repoRoot);
    const idea = requireText(input.idea, 'idea');
    const correlationId = normalizeOptional(input.correlationId);
    const attemptKey = normalizeOptional(input.attemptKey) ?? this.id();

    const lockKeys = [this.attemptLockKey(attemptKey)];
    if (correlationId !== null) lockKeys.push(this.correlationLockKey(correlationId));

    return this.withLocks(lockKeys, async () => {
      const attemptIndex = await this.readAttemptIndex(attemptKey);
      if (attemptIndex) {
        const sameAttemptKey = await this.readMetadata(attemptIndex.engineerRunId);
        if (
          sameAttemptKey.repoRoot !== repoRoot
          || sameAttemptKey.correlationId !== correlationId
          || sameAttemptKey.idea !== idea
        ) {
          throw new EngineerLifecycleError(
            'attempt_key_collision',
            `Engineer attempt key ${JSON.stringify(attemptKey)} was already used with different inputs`,
          );
        }
        return this.inspectRunUnlocked(sameAttemptKey.engineerRunId);
      }

      const correlationIndex = correlationId === null
        ? null
        : await this.readCorrelationIndex(correlationId);
      if (correlationIndex && correlationIndex.repoRoot !== repoRoot) {
        throw new EngineerLifecycleError(
          'correlation_repository_collision',
          `Engineer correlation ${JSON.stringify(correlationId)} belongs to ${correlationIndex.repoRoot}, not ${repoRoot}`,
        );
      }
      if (correlationIndex && correlationIndex.idea !== idea) {
        throw new EngineerLifecycleError(
          'correlation_idea_collision',
          `Engineer correlation ${JSON.stringify(correlationId)} was already used for a different idea`,
        );
      }

      const previousId = correlationIndex?.engineerRunIds.at(-1);
      const previous = previousId ? await this.readMetadata(previousId) : undefined;
      if (previous) {
        const previousSnapshot = await this.inspectRunUnlocked(previous.engineerRunId);
        if (!TERMINAL_STATES.has(previousSnapshot.state)) {
          throw new EngineerLifecycleError(
            'live_attempt_exists',
            `Engineer run ${previous.engineerRunId} is still ${previousSnapshot.state}`,
          );
        }
      }

      const createdAt = this.now().toISOString();
      const run: RunMetadata = {
        schemaVersion: 1,
        engineerRunId: this.id(),
        correlationId,
        attemptKey,
        attempt: previous ? previous.attempt + 1 : 1,
        previousEngineerRunId: previous?.engineerRunId ?? null,
        repoRoot,
        idea,
        createdAt,
      };
      await mkdir(this.runDir(run.engineerRunId), { recursive: true });
      await this.writeJsonAtomic(this.metadataPath(run.engineerRunId), run);
      const event: EngineerLifecycleEvent = {
        ...this.eventBase(run, 1, createdAt),
        type: 'engineer_run_created',
        idea,
      };
      await this.persistAndEmit(run.engineerRunId, event);
      const snapshot = reduceEngineerEvents(await this.readJournal(run.engineerRunId));
      await this.writeSnapshot(snapshot);
      await this.writeJsonAtomic(this.attemptIndexPath(attemptKey), {
        schemaVersion: 1,
        attemptKey,
        engineerRunId: run.engineerRunId,
      } satisfies AttemptIndex);
      if (correlationId !== null) {
        await this.writeJsonAtomic(this.correlationIndexPath(correlationId), {
          schemaVersion: 1,
          correlationId,
          repoRoot,
          idea,
          engineerRunIds: [...(correlationIndex?.engineerRunIds ?? []), run.engineerRunId],
        } satisfies CorrelationIndex);
      }
      return snapshot;
    });
  }

  async inspectRun(engineerRunId: string): Promise<EngineerRunSnapshot> {
    return this.withLocks([this.runLockKey(engineerRunId)], () => this.inspectRunUnlocked(engineerRunId));
  }

  async inspectCorrelation(input: { repoRoot: string; correlationId: string }): Promise<EngineerRunSnapshot[]> {
    const repoRoot = await realpath(input.repoRoot);
    const correlationId = requireText(input.correlationId, 'correlationId');
    const engineerRunIds = await this.withLocks(
      [this.correlationLockKey(correlationId)],
      async () => {
        const index = await this.readCorrelationIndex(correlationId);
        return index?.repoRoot === repoRoot ? [...index.engineerRunIds] : [];
      },
    );
    return Promise.all(engineerRunIds.map((engineerRunId) => this.inspectRun(engineerRunId)));
  }

  async replay(engineerRunId: string, afterRevision: number): Promise<EngineerLifecycleEvent[]> {
    if (!Number.isInteger(afterRevision) || afterRevision < 0) {
      throw new EngineerLifecycleError('revision_regression', 'afterRevision must be a non-negative integer');
    }
    return this.withLocks([this.runLockKey(engineerRunId)], async () => {
      const events = await this.readJournal(engineerRunId);
      const current = events.at(-1)?.revision ?? 0;
      if (afterRevision > current) {
        throw new EngineerLifecycleError(
          'revision_ahead',
          `Requested revision ${afterRevision} is ahead of Engineer run ${engineerRunId} at ${current}`,
        );
      }
      return events.filter((event) => event.revision > afterRevision);
    });
  }

  async record(engineerRunId: string, transition: EngineerTransition): Promise<EngineerRunSnapshot> {
    return this.withLocks([this.runLockKey(engineerRunId)], async () => {
      const snapshot = await this.inspectRunUnlocked(engineerRunId);
      if (TERMINAL_STATES.has(snapshot.state)) {
        throw new EngineerLifecycleError(
          'terminal_run',
          `Engineer run ${engineerRunId} is terminal (${snapshot.state}) and cannot be reopened`,
        );
      }
      const metadata = await this.readMetadata(engineerRunId);
      const event = this.transitionEvent(metadata, snapshot, transition);
      await this.persistAndEmit(engineerRunId, event);
      const next = reduceEngineerEvents([...(await this.readJournal(engineerRunId))]);
      await this.writeSnapshot(next);
      return next;
    });
  }

  async reconcileLand(engineerRunId: string, input: {
    planSlug: string;
    track: 'product' | 'technical';
    tier: ComplexityTier;
    completed: EngineerStepName[];
    skipped: EngineerStepName[];
  }): Promise<EngineerRunSnapshot> {
    let snapshot = await this.inspectRun(engineerRunId);
    const completed = [...new Set(input.completed)];
    const skipped = [...new Set(input.skipped)];
    for (const step of completed) {
      this.assertStep(step);
      const current = snapshot.steps[step];
      if (current?.status === 'skipped') {
        throw new EngineerLifecycleError(
          'invalid_transition',
          `Land evidence proves ${step} completed but the run recorded it skipped`,
        );
      }
      if (current?.status !== 'completed') {
        snapshot = await this.record(engineerRunId, {
          kind: 'step_completed',
          step,
          completion: 'land_reconciliation',
        });
      }
    }
    for (const step of skipped) {
      this.assertStep(step);
      const current = snapshot.steps[step];
      if (current?.status === 'completed') {
        throw new EngineerLifecycleError(
          'invalid_transition',
          `Land evidence proves ${step} skipped but the run recorded it completed`,
        );
      }
      if (current?.status !== 'skipped') {
        snapshot = await this.record(engineerRunId, {
          kind: 'step_skipped',
          step,
          reason: `Not required for ${input.track} track at tier ${input.tier}`,
        });
      }
    }
    return this.record(engineerRunId, {
      kind: 'land_reconciled',
      ...input,
      completed,
      skipped,
    });
  }

  private transitionEvent(
    run: RunMetadata,
    snapshot: EngineerRunSnapshot,
    transition: EngineerTransition,
  ): EngineerLifecycleEvent {
    const base = this.eventBase(run, snapshot.eventRevision + 1, this.now().toISOString());
    if ('step' in transition) this.assertStep(transition.step);
    const stepAttempt = 'step' in transition
      ? this.stepAttempt(snapshot, transition)
      : 0;

    switch (transition.kind) {
      case 'run_started':
        if (snapshot.state !== 'created') this.invalidTransition(transition.kind, snapshot.state);
        return { ...base, type: 'engineer_run_started' };
      case 'routing_selected':
        this.requireAuthoring(snapshot, transition.kind);
        return { ...base, type: 'engineer_routing_selected', project: requireText(transition.project, 'project') };
      case 'worktree_created':
        this.requireAuthoring(snapshot, transition.kind);
        return {
          ...base,
          type: 'engineer_worktree_created',
          worktreePath: requireText(transition.worktreePath, 'worktreePath'),
          branch: requireText(transition.branch, 'branch'),
          planSlug: requireText(transition.planSlug, 'planSlug'),
        };
      case 'step_started':
        this.requireAuthoring(snapshot, transition.kind);
        return {
          ...base,
          type: 'engineer_step_started',
          step: transition.step,
          stepAttempt,
          ...(normalizeOptional(transition.provider) ? { provider: normalizeOptional(transition.provider)! } : {}),
          ...(normalizeOptional(transition.model) ? { model: normalizeOptional(transition.model)! } : {}),
        };
      case 'step_completed': {
        this.requireAuthoring(snapshot, transition.kind);
        const allowed = new Set<EngineerStepCompletionEvidence>([
          'accepted_result',
          'artifact_validation',
          'land_reconciliation',
        ]);
        if (!allowed.has(transition.completion)) {
          throw new EngineerLifecycleError(
            'invalid_completion_evidence',
            `Engineer step completion requires accepted_result, artifact_validation, or land_reconciliation`,
          );
        }
        return {
          ...base,
          type: 'engineer_step_completed',
          step: transition.step,
          stepAttempt,
          completion: transition.completion,
          ...(transition.artifactPaths ? { artifactPaths: transition.artifactPaths } : {}),
        };
      }
      case 'step_failed':
        this.requireAuthoring(snapshot, transition.kind);
        return { ...base, type: 'engineer_step_failed', step: transition.step, stepAttempt, error: requireText(transition.error, 'error') };
      case 'step_retried':
        this.requireAuthoring(snapshot, transition.kind);
        return { ...base, type: 'engineer_step_retried', step: transition.step, stepAttempt, reason: requireText(transition.reason, 'reason') };
      case 'step_skipped':
        this.requireAuthoring(snapshot, transition.kind);
        return { ...base, type: 'engineer_step_skipped', step: transition.step, stepAttempt, reason: requireText(transition.reason, 'reason') };
      case 'land_reconciled':
        this.requireAuthoring(snapshot, transition.kind);
        if (snapshot.reconciliation && snapshot.reconciliation.planSlug !== transition.planSlug) {
          throw new EngineerLifecycleError('identity_mismatch', 'Engineer run cannot reconcile two final plan identities');
        }
        return { ...base, type: 'engineer_land_reconciled', ...transition };
      case 'land_refused':
        this.requireAuthoring(snapshot, transition.kind);
        return { ...base, type: 'engineer_land_refused', reason: requireText(transition.reason, 'reason') };
      case 'spec_handoff':
        this.requireAuthoring(snapshot, transition.kind);
        if (!snapshot.reconciliation || snapshot.reconciliation.planSlug !== transition.planSlug) {
          throw new EngineerLifecycleError('identity_mismatch', 'Spec handoff planSlug must match the reconciled plan identity');
        }
        return {
          ...base,
          type: 'engineer_spec_handoff',
          planSlug: requireText(transition.planSlug, 'planSlug'),
          branch: requireText(transition.branch, 'branch'),
          prUrl: transition.prUrl,
          outcome: transition.outcome,
          state: 'awaiting_spec_merge',
        };
      case 'run_cancelled':
        return { ...base, type: 'engineer_run_cancelled', reason: requireText(transition.reason, 'reason') };
      case 'run_failed':
        return { ...base, type: 'engineer_run_failed', error: requireText(transition.error, 'error') };
      case 'run_settled':
        if (snapshot.state !== 'awaiting_spec_merge') this.invalidTransition(transition.kind, snapshot.state);
        return { ...base, type: 'engineer_run_settled', outcome: transition.outcome };
    }
  }

  private stepAttempt(
    snapshot: EngineerRunSnapshot,
    transition: Extract<EngineerTransition, { step: EngineerStepName }>,
  ): number {
    const { step, kind } = transition;
    const current = snapshot.steps[step];
    if (kind === 'step_retried') return (current?.attempt ?? 0) + 1;
    if (kind === 'step_started') {
      return current?.status === 'retrying' ? current.attempt : (current?.attempt ?? 0) + 1;
    }
    if (kind === 'step_skipped') return current?.attempt ?? 0;
    if (
      kind === 'step_completed'
      && transition.completion === 'land_reconciliation'
      && current === undefined
    ) return 1;
    if (!current || !['started', 'retrying', 'failed'].includes(current.status)) {
      throw new EngineerLifecycleError(
        'invalid_transition',
        `Engineer step ${step} cannot ${kind.replace('step_', '')} before it starts`,
      );
    }
    return current.attempt;
  }

  private assertStep(step: EngineerStepName): void {
    if (!STEP_NAMES.has(step)) {
      throw new EngineerLifecycleError('invalid_step', `Unknown canonical Engineer step ${JSON.stringify(step)}`);
    }
  }

  private requireAuthoring(snapshot: EngineerRunSnapshot, transition: string): void {
    if (snapshot.state !== 'authoring') this.invalidTransition(transition, snapshot.state);
  }

  private invalidTransition(transition: string, state: EngineerRunState): never {
    throw new EngineerLifecycleError(
      'invalid_transition',
      `Engineer transition ${transition} is illegal while the run is ${state}`,
    );
  }

  private eventBase(run: RunMetadata, revision: number, ts: string) {
    return {
      schemaVersion: ENGINEER_LIFECYCLE_SCHEMA_VERSION,
      engineerRunId: run.engineerRunId,
      correlationId: run.correlationId,
      attemptKey: run.attemptKey,
      attempt: run.attempt,
      previousEngineerRunId: run.previousEngineerRunId,
      repoRoot: run.repoRoot,
      revision,
      ts,
    } as const;
  }

  private async inspectRunUnlocked(engineerRunId: string): Promise<EngineerRunSnapshot> {
    await this.readMetadata(engineerRunId);
    const snapshot = reduceEngineerEvents(await this.readJournal(engineerRunId));
    await this.writeSnapshot(snapshot);
    return snapshot;
  }

  private async readJournal(engineerRunId: string): Promise<EngineerLifecycleEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.journalPath(engineerRunId), 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new EngineerLifecycleError('run_not_found', `Engineer run ${engineerRunId} has no durable journal`);
      }
      throw error;
    }
    const events: EngineerLifecycleEvent[] = [];
    for (const [index, line] of raw.split('\n').entries()) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new EngineerLifecycleError('journal_corrupt', `Engineer journal ${engineerRunId} has invalid JSON at line ${index + 1}`);
      }
      if (!isRecord(parsed) || parsed.schemaVersion !== ENGINEER_LIFECYCLE_SCHEMA_VERSION) {
        throw new EngineerLifecycleError('schema_mismatch', `Engineer journal ${engineerRunId} uses an unsupported schema at line ${index + 1}`);
      }
      if (
        typeof parsed.type !== 'string'
        || !parsed.type.startsWith('engineer_')
        || parsed.engineerRunId !== engineerRunId
      ) {
        throw new EngineerLifecycleError('journal_corrupt', `Engineer journal ${engineerRunId} has invalid identity at line ${index + 1}`);
      }
      if (parsed.revision !== events.length + 1) {
        throw new EngineerLifecycleError('journal_corrupt', `Engineer journal ${engineerRunId} has a non-monotonic revision at line ${index + 1}`);
      }
      events.push(parsed as unknown as EngineerLifecycleEvent);
    }
    if (events.length === 0 || events[0]?.type !== 'engineer_run_created') {
      throw new EngineerLifecycleError('journal_corrupt', `Engineer journal ${engineerRunId} has no run-created event`);
    }
    return events;
  }

  private async persistAndEmit(engineerRunId: string, event: EngineerLifecycleEvent): Promise<void> {
    const persister = new EventPersister(
      this.journalPath(engineerRunId),
      this.events,
      undefined,
      (event) => 'engineerRunId' in event && event.engineerRunId === engineerRunId,
    );
    persister.start();
    try {
      await this.events.emitOrThrow(event);
    } finally {
      persister.stop();
    }
  }

  private async readMetadata(engineerRunId: string): Promise<RunMetadata> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(this.metadataPath(engineerRunId), 'utf-8'));
    } catch (error) {
      if (error instanceof EngineerLifecycleError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new EngineerLifecycleError('run_not_found', `Unknown Engineer run ${engineerRunId}`);
      }
      throw new EngineerLifecycleError('journal_corrupt', `Engineer metadata for ${engineerRunId} is unreadable`);
    }
    if (!isRecord(parsed) || parsed.schemaVersion !== ENGINEER_LIFECYCLE_SCHEMA_VERSION) {
      throw new EngineerLifecycleError('schema_mismatch', `Engineer metadata for ${engineerRunId} uses an unsupported schema`);
    }
    return parsed as unknown as RunMetadata;
  }

  private async readAttemptIndex(attemptKey: string): Promise<AttemptIndex | null> {
    const parsed = await this.readOptionalJson(
      this.attemptIndexPath(attemptKey),
      `Engineer attempt index ${JSON.stringify(attemptKey)}`,
    );
    if (parsed === null) return null;
    if (!isRecord(parsed) || parsed.schemaVersion !== ENGINEER_LIFECYCLE_SCHEMA_VERSION) {
      throw new EngineerLifecycleError(
        'schema_mismatch',
        `Engineer attempt index ${JSON.stringify(attemptKey)} uses an unsupported schema`,
      );
    }
    if (parsed.attemptKey !== attemptKey || typeof parsed.engineerRunId !== 'string') {
      throw new EngineerLifecycleError(
        'journal_corrupt',
        `Engineer attempt index ${JSON.stringify(attemptKey)} has invalid identity`,
      );
    }
    this.runDir(parsed.engineerRunId);
    return parsed as unknown as AttemptIndex;
  }

  private async readCorrelationIndex(correlationId: string): Promise<CorrelationIndex | null> {
    const parsed = await this.readOptionalJson(
      this.correlationIndexPath(correlationId),
      `Engineer correlation index ${JSON.stringify(correlationId)}`,
    );
    if (parsed === null) return null;
    if (!isRecord(parsed) || parsed.schemaVersion !== ENGINEER_LIFECYCLE_SCHEMA_VERSION) {
      throw new EngineerLifecycleError(
        'schema_mismatch',
        `Engineer correlation index ${JSON.stringify(correlationId)} uses an unsupported schema`,
      );
    }
    if (
      parsed.correlationId !== correlationId
      || typeof parsed.repoRoot !== 'string'
      || typeof parsed.idea !== 'string'
      || !Array.isArray(parsed.engineerRunIds)
      || !parsed.engineerRunIds.every((engineerRunId) => typeof engineerRunId === 'string')
    ) {
      throw new EngineerLifecycleError(
        'journal_corrupt',
        `Engineer correlation index ${JSON.stringify(correlationId)} has invalid identity`,
      );
    }
    for (const engineerRunId of parsed.engineerRunIds) this.runDir(engineerRunId);
    return parsed as unknown as CorrelationIndex;
  }

  private async readOptionalJson(path: string, label: string): Promise<unknown | null> {
    try {
      return JSON.parse(await readFile(path, 'utf-8')) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new EngineerLifecycleError('journal_corrupt', `${label} is unreadable`);
    }
  }

  private async writeSnapshot(snapshot: EngineerRunSnapshot): Promise<void> {
    await this.writeJsonAtomic(this.snapshotPath(snapshot.engineerRunId), snapshot);
  }

  private async writeJsonAtomic(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp.${process.pid}.${this.id()}`;
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf-8');
    await rename(temporary, path);
  }

  private async withLocks<T>(keys: string[], run: () => Promise<T>): Promise<T> {
    const releases: Array<() => Promise<void>> = [];
    try {
      for (const key of [...new Set(keys)].sort()) releases.push(await this.acquireLock(key));
      return await run();
    } finally {
      for (const release of releases.reverse()) await release();
    }
  }

  private async acquireLock(key: string): Promise<() => Promise<void>> {
    await mkdir(this.locksRoot, { recursive: true });
    const lockPath = join(this.locksRoot, this.identityHash(key));
    const deadline = Date.now() + 35_000;
    for (;;) {
      try {
        await mkdir(lockPath);
        return () => rm(lockPath, { recursive: true, force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          const age = Date.now() - (await stat(lockPath)).mtimeMs;
          if (age > 30_000) {
            await rm(lockPath, { recursive: true, force: true });
            continue;
          }
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw statError;
        }
        if (Date.now() >= deadline) {
          throw new EngineerLifecycleError(
            'lock_timeout',
            `Timed out acquiring Engineer lifecycle lock for ${JSON.stringify(key)}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
  }

  private attemptLockKey(attemptKey: string): string {
    return `attempt:${attemptKey}`;
  }

  private correlationLockKey(correlationId: string): string {
    return `correlation:${correlationId}`;
  }

  private runLockKey(engineerRunId: string): string {
    this.runDir(engineerRunId);
    return `run:${engineerRunId}`;
  }

  private identityHash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private attemptIndexPath(attemptKey: string): string {
    return join(this.attemptsRoot, `${this.identityHash(attemptKey)}.json`);
  }

  private correlationIndexPath(correlationId: string): string {
    return join(this.correlationsRoot, `${this.identityHash(correlationId)}.json`);
  }

  private runDir(engineerRunId: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(engineerRunId)) {
      throw new EngineerLifecycleError(
        'invalid_run_id',
        `Engineer run id ${JSON.stringify(engineerRunId)} is not a valid durable identity`,
      );
    }
    return join(this.runsRoot, engineerRunId);
  }

  private metadataPath(engineerRunId: string): string {
    return join(this.runDir(engineerRunId), 'metadata.json');
  }

  private snapshotPath(engineerRunId: string): string {
    return join(this.runDir(engineerRunId), 'snapshot.json');
  }

  private journalPath(engineerRunId: string): string {
    return join(this.runDir(engineerRunId), 'events.jsonl');
  }
}

export function reduceEngineerEvents(events: readonly EngineerLifecycleEvent[]): EngineerRunSnapshot {
  const created = events[0];
  if (!created || created.type !== 'engineer_run_created') {
    throw new EngineerLifecycleError('journal_corrupt', 'Engineer lifecycle requires engineer_run_created at revision 1');
  }
  const snapshot: EngineerRunSnapshot = {
    schemaVersion: 1,
    capability: ENGINEER_LIFECYCLE_CAPABILITY,
    engineerRunId: created.engineerRunId,
    correlationId: created.correlationId,
    attemptKey: created.attemptKey,
    attempt: created.attempt,
    previousEngineerRunId: created.previousEngineerRunId,
    repoRoot: created.repoRoot,
    idea: created.idea,
    eventRevision: 1,
    state: 'created',
    project: null,
    worktree: null,
    steps: {},
    reconciliation: null,
    handoff: null,
    terminalReason: null,
    createdAt: created.ts,
    updatedAt: created.ts,
  };
  for (const event of events.slice(1)) {
    snapshot.eventRevision = event.revision;
    snapshot.updatedAt = event.ts;
    switch (event.type) {
      case 'engineer_run_created':
        throw new EngineerLifecycleError('journal_corrupt', 'Engineer journal contains more than one run-created event');
      case 'engineer_run_started':
        snapshot.state = 'authoring';
        break;
      case 'engineer_routing_selected':
        snapshot.project = event.project;
        break;
      case 'engineer_worktree_created':
        snapshot.worktree = { path: event.worktreePath, branch: event.branch, planSlug: event.planSlug };
        break;
      case 'engineer_step_started':
        snapshot.steps[event.step] = {
          status: 'started',
          attempt: event.stepAttempt,
          ...(event.provider ? { provider: event.provider } : {}),
          ...(event.model ? { model: event.model } : {}),
        };
        break;
      case 'engineer_step_completed':
        snapshot.steps[event.step] = {
          ...snapshot.steps[event.step],
          status: 'completed',
          attempt: event.stepAttempt,
          completion: event.completion,
          ...(event.artifactPaths ? { artifactPaths: event.artifactPaths } : {}),
        };
        break;
      case 'engineer_step_failed':
        snapshot.steps[event.step] = { ...snapshot.steps[event.step], status: 'failed', attempt: event.stepAttempt, error: event.error };
        break;
      case 'engineer_step_retried':
        snapshot.steps[event.step] = { ...snapshot.steps[event.step], status: 'retrying', attempt: event.stepAttempt, reason: event.reason };
        break;
      case 'engineer_step_skipped':
        snapshot.steps[event.step] = { status: 'skipped', attempt: event.stepAttempt, reason: event.reason };
        break;
      case 'engineer_land_reconciled':
        snapshot.reconciliation = {
          planSlug: event.planSlug,
          track: event.track,
          tier: event.tier,
          completed: [...event.completed],
          skipped: [...event.skipped],
        };
        break;
      case 'engineer_land_refused':
        snapshot.terminalReason = event.reason;
        break;
      case 'engineer_spec_handoff':
        snapshot.state = 'awaiting_spec_merge';
        snapshot.handoff = {
          planSlug: event.planSlug,
          branch: event.branch,
          prUrl: event.prUrl,
          outcome: event.outcome,
        };
        break;
      case 'engineer_run_cancelled':
        snapshot.state = 'cancelled';
        snapshot.terminalReason = event.reason;
        break;
      case 'engineer_run_failed':
        snapshot.state = 'failed';
        snapshot.terminalReason = event.error;
        break;
      case 'engineer_run_settled':
        snapshot.state = 'settled';
        break;
    }
  }
  return snapshot;
}

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function requireText(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new EngineerLifecycleError('invalid_transition', `${name} must not be empty`);
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

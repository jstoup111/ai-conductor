import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type {
  ConductorEvent,
  GithubBypassAttemptEvent,
  GithubBypassCliOutcome,
  GithubBypassResultEvent,
  GithubPossibleBypassEvent,
  SessionCommandRefusedEvent,
  SessionEventDeliveryDiagnosticEvent,
  SessionObservationScope,
} from '../types/events.js';
import { createSessionEventIdentity, isSessionEventIdentity } from './session-event-identity.js';

/** PIPE_BUF-safe ceiling for one producer-owned JSONL record, including its newline. */
export const MAX_SESSION_EVENT_RECORD_BYTES = 4_096;

export interface SessionEventProducerContext {
  readonly projectRoot: string;
  readonly worktreeRoot: string;
  readonly producerRoot: string;
  readonly dispatchId: string;
  readonly provider: string;
  readonly scope: SessionObservationScope;
}

export interface SessionEventProducerDependencies {
  readonly producerId?: string;
  readonly generateId?: () => string;
  readonly now?: () => string;
  readonly append?: (path: string, record: string) => void;
}

export class SessionEventProducerError extends Error {
  constructor(readonly code: Extract<SessionEventDeliveryDiagnosticEvent['code'], 'producer-path-invalid' | 'record-too-large' | 'write-failed'>) {
    super(`session event producer: ${code}`);
    this.name = 'SessionEventProducerError';
  }
}

/**
 * The only writer for one managed session process. It emits the existing
 * ConductorEvent schema into a dispatch-local JSONL file for tail projection.
 */
export class SessionEventProducer {
  readonly path: string;
  private readonly producerId: string;
  private readonly generateId: () => string;
  private readonly now: () => string;
  private readonly appendRecord: (path: string, record: string) => void;

  constructor(
    readonly context: SessionEventProducerContext,
    dependencies: SessionEventProducerDependencies = {},
  ) {
    // UUIDs may begin with a digit, while producer file identities are
    // deliberately letter-prefixed. Keep the random portion but make the
    // default producer usable for production entry-point observations.
    this.producerId = dependencies.producerId ?? createSessionEventIdentity('p');
    if (!isIdentity(this.producerId)) throw new SessionEventProducerError('producer-path-invalid');
    this.path = join(context.producerRoot, `${this.producerId}.jsonl`);
    this.generateId = dependencies.generateId ?? (() => createSessionEventIdentity('e'));
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.appendRecord = dependencies.append ?? ((path, record) => {
      mkdirSync(context.producerRoot, { recursive: true });
      appendFileSync(path, record, 'utf8');
    });
  }

  refusal(input: { subcommand: unknown }): SessionCommandRefusedEvent {
    return { ...this.base('session_command_refused'), subcommand: safeIdentity(input.subcommand) };
  }

  bypassAttempt(input: { operation: unknown }): GithubBypassAttemptEvent {
    return { ...this.base('github_bypass_attempt'), operation: safeIdentity(input.operation) };
  }

  bypassResult(
    attempt: Pick<GithubBypassAttemptEvent, 'eventId'>,
    input: { outcome: GithubBypassCliOutcome },
  ): GithubBypassResultEvent {
    return {
      ...this.base('github_bypass_result'),
      attemptId: isIdentity(attempt.eventId) ? attempt.eventId : 'unknown',
      outcome: input.outcome === 'cli-succeeded' || input.outcome === 'cli-failed' ? input.outcome : 'unknown',
    };
  }

  possibleBypass(input: { operation: unknown }): GithubPossibleBypassEvent {
    return { ...this.base('github_possible_bypass'), operation: safeIdentity(input.operation) };
  }

  deliveryDiagnostic(code: SessionEventDeliveryDiagnosticEvent['code']): SessionEventDeliveryDiagnosticEvent {
    return {
      ...this.base('session_event_delivery_diagnostic'),
      code: code === 'producer-path-invalid' || code === 'record-too-large' ? code : 'write-failed',
    };
  }

  /** Append one complete, bounded record. A failed write carries no raw OS error. */
  async append(event: ConductorEvent): Promise<string> {
    const record = `${JSON.stringify(event)}\n`;
    if (Buffer.byteLength(record, 'utf8') > MAX_SESSION_EVENT_RECORD_BYTES) {
      throw new SessionEventProducerError('record-too-large');
    }
    try {
      this.appendRecord(this.path, record);
      return this.path;
    } catch {
      throw new SessionEventProducerError('write-failed');
    }
  }

  private base<Type extends ConductorEvent['type']>(type: Type): Extract<ConductorEvent, { type: Type }> {
    return {
      type,
      eventId: safeGeneratedId(this.generateId()),
      sourceTime: safeSourceTime(this.now()),
      dispatchId: safeIdentity(this.context.dispatchId),
      provider: safeIdentity(this.context.provider),
      scope: safeScope(this.context.scope),
    } as Extract<ConductorEvent, { type: Type }>;
  }
}

function safeScope(scope: SessionObservationScope): SessionObservationScope {
  return scope.kind === 'feature' && isIdentity(scope.featureSlug)
    ? { kind: 'feature', featureSlug: scope.featureSlug }
    : { kind: 'project' };
}

function safeGeneratedId(value: unknown): string {
  return isIdentity(value) ? value : 'unknown';
}

function safeSourceTime(value: unknown): string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : '1970-01-01T00:00:00.000Z';
}

function safeIdentity(value: unknown): string | 'unknown' {
  return isIdentity(value) ? value : 'unknown';
}

function isIdentity(value: unknown): value is string {
  return isSessionEventIdentity(value);
}
